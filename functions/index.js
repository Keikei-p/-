const crypto = require("crypto");

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");

initializeApp();

setGlobalOptions({
  region: "asia-northeast1",
  maxInstances: 10,
});

const db = getFirestore();

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCompanyName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function requireVerifiedUser(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "ログインが必要です。");
  }

  if (request.auth.token.email_verified !== true) {
    throw new HttpsError(
      "failed-precondition",
      "メールアドレスの確認が必要です。"
    );
  }

  return {
    uid: request.auth.uid,
    email: normalizeEmail(request.auth.token.email),
  };
}

async function getCompanyContext(uid) {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "ユーザー情報が見つかりません。"
    );
  }

  const userData = userSnap.data() || {};
  const companyId = userData.companyId || null;

  if (!companyId) {
    throw new HttpsError(
      "failed-precondition",
      "会社に所属していません。"
    );
  }

  const memberRef = db
    .collection("companies")
    .doc(companyId)
    .collection("members")
    .doc(uid);

  const memberSnap = await memberRef.get();

  if (!memberSnap.exists || memberSnap.data()?.active !== true) {
    throw new HttpsError(
      "permission-denied",
      "会社の有効なメンバーではありません。"
    );
  }

  return {
    userRef,
    userData,
    companyId,
    memberRef,
    memberData: memberSnap.data() || {},
  };
}

exports.createCompany = onCall(async (request) => {
  const { uid, email } = requireVerifiedUser(request);
  const companyName = normalizeCompanyName(request.data?.name);

  if (companyName.length < 2 || companyName.length > 80) {
    throw new HttpsError(
      "invalid-argument",
      "会社名は2〜80文字で入力してください。"
    );
  }

  const userRef = db.collection("users").doc(uid);
  const companyRef = db.collection("companies").doc();
  const memberRef = companyRef.collection("members").doc(uid);

  await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);

    if (!userSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "ユーザー情報が見つかりません。"
      );
    }

    const userData = userSnap.data() || {};

    if (userData.companyId) {
      throw new HttpsError(
        "already-exists",
        "すでに会社に所属しています。"
      );
    }

    const displayName =
      String(userData.name || request.auth.token.name || "名前未設定").trim();

    transaction.set(companyRef, {
      name: companyName,
      ownerUid: uid,
      active: true,
      createdBy: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(memberRef, {
      uid,
      name: displayName || "名前未設定",
      email,
      role: "leader",
      companyRole: "owner",
      teamId: null,
      active: true,
      joinedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    transaction.set(
      userRef,
      {
        companyId: companyRef.id,
        companyRole: "owner",
        role: "leader",
        teamId: null,
        companySetupVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return {
    companyId: companyRef.id,
    companyName,
    companyRole: "owner",
  };
});

exports.createInvitation = onCall(async (request) => {
  const { uid } = requireVerifiedUser(request);
  const email = normalizeEmail(request.data?.email);
  const role = request.data?.role === "leader" ? "leader" : "member";

  if (!email || !email.includes("@") || email.length > 254) {
    throw new HttpsError(
      "invalid-argument",
      "招待先メールアドレスを確認してください。"
    );
  }

  const context = await getCompanyContext(uid);
  const companyRole = context.memberData.companyRole || "";
  const currentRole = context.memberData.role || "";

  if (
    companyRole !== "owner" &&
    companyRole !== "admin" &&
    currentRole !== "leader"
  ) {
    throw new HttpsError(
      "permission-denied",
      "招待を作成する権限がありません。"
    );
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const inviteRef = db.collection("invitations").doc();
  const expiresAt = Timestamp.fromMillis(
    Date.now() + 7 * 24 * 60 * 60 * 1000
  );

  await inviteRef.set({
    companyId: context.companyId,
    emailLower: email,
    role,
    tokenHash,
    status: "pending",
    invitedBy: uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  return {
    invitationId: inviteRef.id,
    token,
    expiresAt: expiresAt.toMillis(),
  };
});

exports.getInvitationPreview = onCall(async (request) => {
  const { email } = requireVerifiedUser(request);
  const token = String(request.data?.token || "").trim();

  if (token.length < 20) {
    throw new HttpsError("invalid-argument", "招待リンクが正しくありません。");
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const inviteQuery = await db
    .collection("invitations")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();

  if (inviteQuery.empty) {
    throw new HttpsError("not-found", "招待が見つかりません。");
  }

  const invite = inviteQuery.docs[0].data();

  if (
    invite.status !== "pending" ||
    !invite.expiresAt ||
    invite.expiresAt.toMillis() <= Date.now()
  ) {
    throw new HttpsError(
      "failed-precondition",
      "この招待は期限切れ、または使用済みです。"
    );
  }

  if (normalizeEmail(invite.emailLower) !== email) {
    throw new HttpsError(
      "permission-denied",
      "この招待は別のメールアドレス宛てです。"
    );
  }

  const companySnap = await db
    .collection("companies")
    .doc(invite.companyId)
    .get();

  if (!companySnap.exists || companySnap.data()?.active !== true) {
    throw new HttpsError(
      "failed-precondition",
      "招待元の会社を利用できません。"
    );
  }

  return {
    companyId: invite.companyId,
    companyName: companySnap.data()?.name || "会社",
    role: invite.role || "member",
  };
});

exports.acceptInvitation = onCall(async (request) => {
  const { uid, email } = requireVerifiedUser(request);
  const token = String(request.data?.token || "").trim();

  if (token.length < 20) {
    throw new HttpsError("invalid-argument", "招待リンクが正しくありません。");
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const inviteQuery = await db
    .collection("invitations")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();

  if (inviteQuery.empty) {
    throw new HttpsError("not-found", "招待が見つかりません。");
  }

  const inviteRef = inviteQuery.docs[0].ref;
  const userRef = db.collection("users").doc(uid);

  let result = null;

  await db.runTransaction(async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    const userSnap = await transaction.get(userRef);

    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "招待が見つかりません。");
    }

    if (!userSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "ユーザー情報が見つかりません。"
      );
    }

    const invite = inviteSnap.data() || {};
    const userData = userSnap.data() || {};

    if (
      invite.status !== "pending" ||
      !invite.expiresAt ||
      invite.expiresAt.toMillis() <= Date.now()
    ) {
      throw new HttpsError(
        "failed-precondition",
        "この招待は期限切れ、または使用済みです。"
      );
    }

    if (normalizeEmail(invite.emailLower) !== email) {
      throw new HttpsError(
        "permission-denied",
        "この招待は別のメールアドレス宛てです。"
      );
    }

    if (userData.companyId && userData.companyId !== invite.companyId) {
      throw new HttpsError(
        "failed-precondition",
        "すでに別の会社に所属しています。"
      );
    }

    const companyRef = db.collection("companies").doc(invite.companyId);
    const companySnap = await transaction.get(companyRef);

    if (!companySnap.exists || companySnap.data()?.active !== true) {
      throw new HttpsError(
        "failed-precondition",
        "招待元の会社を利用できません。"
      );
    }

    const memberRef = companyRef.collection("members").doc(uid);
    const displayName =
      String(userData.name || request.auth.token.name || "名前未設定").trim();
    const role = invite.role === "leader" ? "leader" : "member";

    transaction.set(
      memberRef,
      {
        uid,
        name: displayName || "名前未設定",
        email,
        role,
        companyRole: "member",
        teamId: null,
        active: true,
        joinedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    transaction.set(
      userRef,
      {
        companyId: invite.companyId,
        companyRole: "member",
        role,
        teamId: null,
        companySetupVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    transaction.update(inviteRef, {
      status: "accepted",
      acceptedBy: uid,
      acceptedAt: FieldValue.serverTimestamp(),
    });

    result = {
      companyId: invite.companyId,
      companyName: companySnap.data()?.name || "会社",
      role,
    };
  });

  return result;
});


/*
 * Partner-company invitations are separate from the legacy same-company link.
 * No partner invite can reuse the existing browser-writable invitations flow.
 * These callable functions MUST NOT be deployed until partner finance Rules,
 * account compatibility, catalog source and rollback checks have passed.
 */
const partnerInviteTokenHash = (token) => crypto.createHash("sha256")
  .update(String(token)).digest("hex");

async function findPartnerCompanyInvite(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw new HttpsError("invalid-argument", "協力店の招待リンクが正しくありません。");
  }
  const query = await db.collection("invitations")
    .where("tokenHash", "==", partnerInviteTokenHash(token))
    .limit(1).get();
  if (query.empty || query.docs[0].data()?.kind !== "partner_company") {
    throw new HttpsError("not-found", "協力店の招待リンクが見つかりません。");
  }
  return query.docs[0];
}
async function assertCompanyOwner(uid,companyId) {
  const [companySnap,memberSnap] = await Promise.all([
    db.collection("companies").doc(companyId).get(),
    db.collection("companies").doc(companyId).collection("members").doc(uid).get()
  ]);
  if (!companySnap.exists || companySnap.data()?.active !== true ||
      companySnap.data()?.ownerUid !== uid ||
      !memberSnap.exists || memberSnap.data()?.active !== true ||
      memberSnap.data()?.companyRole !== "owner") {
    throw new HttpsError("permission-denied",
      "協力店の招待は自社の代表オーナーのみ作成できます。");
  }
  return companySnap;
}
exports.createPartnerCompanyInvitation = onCall(async (request) => {
  const {uid,email:actorEmail} = requireVerifiedUser(request);
  const context = await getCompanyContext(uid);
  if (context.userData.active === false) {
    throw new HttpsError("permission-denied", "無効なアカウントです。");
  }
  await assertCompanyOwner(uid,context.companyId);
  const email = normalizeEmail(request.data?.email);
  const companyName = normalizeCompanyName(request.data?.partnerCompanyName);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email === actorEmail || companyName.length < 2 || companyName.length > 80 ||
      /[¥￥$€]/.test(companyName)) {
    throw new HttpsError("invalid-argument",
      "協力店名または招待するメールアドレスを確認してください。");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const inviteRef = db.collection("invitations").doc();
  const expiresAt = Timestamp.fromMillis(Date.now() + 30*60*1000);
  await inviteRef.create({
    kind:"partner_company",
    hubCompanyId:context.companyId,
    partnerCompanyName:companyName,
    emailLower:email,
    tokenHash:partnerInviteTokenHash(token),
    accessKind:"partner",
    canViewRevenue:false,
    canViewUnitPrice:false,
    countOnly:true,
    status:"pending",
    invitedBy:uid,
    createdAt:FieldValue.serverTimestamp(),
    expiresAt
  });
  return {token,expiresAt:expiresAt.toMillis(),inviteType:"partner_company"};
});
exports.previewPartnerCompanyInvitation = onCall(async (request) => {
  const {email} = requireVerifiedUser(request);
  const snap = await findPartnerCompanyInvite(request.data?.token);
  const data = snap.data() || {};
  if (data.emailLower !== email || data.status !== "pending" ||
      !data.expiresAt || data.expiresAt.toMillis() <= Date.now()) {
    throw new HttpsError("permission-denied",
      "この協力店の招待は利用できません。");
  }
  const hub = await db.collection("companies").doc(data.hubCompanyId).get();
  if (!hub.exists || hub.data()?.active !== true) {
    throw new HttpsError("failed-precondition","招待元の会社は利用できません。");
  }
  return {
    companyName:data.partnerCompanyName,
    inviterCompanyName:hub.data().name||"招待元会社",
    inviteType:"partner_company",
    role:"leader",
    // Do not expose source product prices, owner IDs or financial fields.
    financialAccess:false,
    expiresAt:data.expiresAt.toMillis()
  };
});
exports.acceptPartnerCompanyInvitation = onCall(async (request) => {
  const {uid,email} = requireVerifiedUser(request);
  const inviteDoc = await findPartnerCompanyInvite(request.data?.token);
  const companyRef = db.collection("companies").doc();
  const memberRef = companyRef.collection("members").doc(uid);
  const userRef = db.collection("users").doc(uid);
  const partnerRelationRef = db.collection("partnerRelations").doc(companyRef.id);
  let result;
  await db.runTransaction(async tx => {
    const [inviteSnap,userSnap,companySnap] = await Promise.all([
      tx.get(inviteDoc.ref),
      tx.get(userRef),
      tx.get(companyRef)
    ]);
    if (!inviteSnap.exists || !userSnap.exists || companySnap.exists) {
      throw new HttpsError("failed-precondition","招待またはアカウントを確認できません。");
    }
    const invite = inviteSnap.data() || {},user = userSnap.data()||{};
    if (invite.kind!=="partner_company"||invite.status!=="pending"||
        invite.emailLower!==email||!invite.expiresAt||
        invite.expiresAt.toMillis()<=Date.now()||
        invite.canViewRevenue!==false||invite.canViewUnitPrice!==false||
        invite.countOnly!==true||
        user.companyId || user.active===false) {
      throw new HttpsError("failed-precondition",
        "協力店の招待は利用できません。既存の会社所属は変更しません。");
    }
    const hubRef=db.collection("companies").doc(invite.hubCompanyId);
    const inviterRef=hubRef.collection("members").doc(invite.invitedBy);
    const [hubSnap,inviterSnap] = await Promise.all([tx.get(hubRef),tx.get(inviterRef)]);
    if (!hubSnap.exists||hubSnap.data()?.active!==true||
        hubSnap.data()?.ownerUid!==invite.invitedBy||
        !inviterSnap.exists||inviterSnap.data()?.active!==true||
        inviterSnap.data()?.companyRole!=="owner") {
      throw new HttpsError("permission-denied","招待元の承認が無効になりました。");
    }
    const name=normalizeCompanyName(invite.partnerCompanyName);
    if(name.length<2||name.length>80) {
      throw new HttpsError("invalid-argument","協力店名が正しくありません。");
    }
    const displayName=String(user.name||request.auth.token.name||"名前未設定").trim();
    tx.create(companyRef,{
      name,ownerUid:uid,masterUid:uid,companyKind:"partner",
      hubCompanyId:invite.hubCompanyId,
      catalogSourceCompanyId:invite.hubCompanyId,
      accessKind:"partner",active:true,
      createdBy:uid,createdAt:FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp()
    });
    tx.create(memberRef,{
      uid,name:displayName||"名前未設定",email,role:"leader",
      companyRole:"owner",accessKind:"partner",companyId:companyRef.id,
      teamId:null,active:true,canViewRevenue:false,
      canViewUnitPrice:false,canCreateInvite:false,
      joinedAt:FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp()
    });
    tx.update(userRef,{
      companyId:companyRef.id,companyRole:"owner",role:"leader",
      accessKind:"partner",canViewRevenue:false,
      canViewUnitPrice:false,canCreateInvite:false,
      teamId:null,companySetupVersion:1,
      updatedAt:FieldValue.serverTimestamp()
    });
    tx.create(partnerRelationRef,{
      hubCompanyId:invite.hubCompanyId,partnerCompanyId:companyRef.id,
      invitedBy:invite.invitedBy,acceptedBy:uid,
      originInviteId:inviteDoc.id,
      active:true,catalogAccessApproved:true,
      countSharingApproved:true,
      ownProductDefaultVisibility:"private",
      createdAt:FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp()
    });
    tx.update(inviteDoc.ref,{
      status:"accepted",acceptedBy:uid,
      acceptedAt:FieldValue.serverTimestamp()
    });
    result={companyId:companyRef.id,companyName:name,
      accessKind:"partner",catalogSourceCompanyId:invite.hubCompanyId};
  });
  return result;
});

exports.deleteCompanyMemberAccount = onCall(async (request) => {
  const { uid } = requireVerifiedUser(request);
  const targetUid = String(request.data?.uid || "").trim();

  if (!targetUid || targetUid.length > 128) {
    throw new HttpsError(
      "invalid-argument",
      "削除対象のメンバーを確認できません。"
    );
  }

  if (targetUid === uid) {
    throw new HttpsError(
      "failed-precondition",
      "自分のアカウント削除はアカウント設定から行ってください。"
    );
  }

  const context = await getCompanyContext(uid);

  if (context.memberData.companyRole !== "owner") {
    throw new HttpsError(
      "permission-denied",
      "メンバーを完全削除できるのはオーナーだけです。"
    );
  }

  const targetMemberRef = db
    .collection("companies")
    .doc(context.companyId)
    .collection("members")
    .doc(targetUid);

  const targetUserRef = db.collection("users").doc(targetUid);

  const [targetMemberSnap, targetUserSnap] = await Promise.all([
    targetMemberRef.get(),
    targetUserRef.get(),
  ]);

  if (!targetMemberSnap.exists) {
    throw new HttpsError(
      "not-found",
      "削除対象の会社メンバーが見つかりません。"
    );
  }

  const targetMember = targetMemberSnap.data() || {};

  if (targetMember.companyRole === "owner") {
    throw new HttpsError(
      "failed-precondition",
      "オーナーはこの操作では削除できません。先に役割を変更してください。"
    );
  }

  // 先に利用停止して、Auth削除途中でもアプリへ再アクセスできないようにする。
  const disableBatch = db.batch();

  disableBatch.set(
    targetMemberRef,
    {
      active: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (targetUserSnap.exists) {
    disableBatch.set(
      targetUserRef,
      {
        active: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  await disableBatch.commit();

  let authDeleted = false;
  let authAlreadyMissing = false;

  try {
    await getAuth().deleteUser(targetUid);
    authDeleted = true;
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      authAlreadyMissing = true;
    } else {
      throw new HttpsError(
        "internal",
        "Firebase Authenticationアカウントの削除に失敗しました。"
      );
    }
  }

  // 過去実績はrecords側に残す。メンバー/ユーザー本体だけ削除する。
  const cleanupBatch = db.batch();

  cleanupBatch.delete(targetMemberRef);

  if (targetUserSnap.exists) {
    cleanupBatch.delete(targetUserRef);
  }

  await cleanupBatch.commit();

  return {
    ok: true,
    authDeleted,
    authAlreadyMissing,
  };
});


/* =====================================================
   LINEグループ自動連携 Webhook
===================================================== */

function verifyLineWebhookSignature(rawBody, signature) {
  const channelSecret =
    process.env.LINE_CHANNEL_SECRET || "";

  if (
    !channelSecret ||
    !signature ||
    !Buffer.isBuffer(rawBody)
  ) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  const expectedBuffer =
    Buffer.from(expected);

  const actualBuffer =
    Buffer.from(String(signature));

  if (
    expectedBuffer.length !==
    actualBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    actualBuffer
  );
}

async function getLineGroupSummary(groupId) {
  const token =
    process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN が設定されていません。"
    );
  }

  const response = await fetch(
    `https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `LINEグループ情報取得失敗: ${response.status} ${detail}`
    );
  }

  return response.json();
}

async function replyLineMessage(replyToken, text) {
  const token =
    process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

  if (
    !token ||
    !replyToken
  ) {
    return;
  }

  const response = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [
          {
            type: "text",
            text,
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `LINE返信失敗: ${response.status} ${detail}`
    );
  }
}

async function handleLinePairingEvent(event) {
  if (
    event?.type !== "message" ||
    event?.message?.type !== "text" ||
    event?.source?.type !== "group" ||
    !event?.source?.groupId
  ) {
    return;
  }

  const text =
    String(
      event.message.text || ""
    ).trim();

  const matched =
    text.match(
      /^連携\s+([A-Z0-9]{8})$/i
    );

  if (!matched) {
    return;
  }

  const code =
    matched[1].toUpperCase();

  const pairingRef =
    db
      .collection("linePairingCodes")
      .doc(code);

  const pairingSnap =
    await pairingRef.get();

  if (!pairingSnap.exists) {
    await replyLineMessage(
      event.replyToken,
      "連携コードが見つかりません。アプリの通知タブから新しいコードを発行してください。"
    );
    return;
  }

  const pairing =
    pairingSnap.data() || {};

  const expiresAtMs =
    pairing.expiresAt?.toMillis
      ? pairing.expiresAt.toMillis()
      : 0;

  if (
    pairing.status !== "pending" ||
    expiresAtMs <= Date.now() ||
    !pairing.companyId
  ) {
    await replyLineMessage(
      event.replyToken,
      "この連携コードは使用済み、または期限切れです。アプリから新しいコードを発行してください。"
    );
    return;
  }

  const groupId =
    String(
      event.source.groupId
    );

  let groupName =
    "LINEグループ";

  try {
    const summary =
      await getLineGroupSummary(
        groupId
      );

    groupName =
      String(
        summary?.groupName ||
        groupName
      ).slice(0, 100);
  } catch (error) {
    console.error(
      "LINEグループ名取得エラー:",
      error
    );
  }

  const settingsRef =
    db
      .collection("companies")
      .doc(pairing.companyId)
      .collection("settings")
      .doc("notifications");

  await db.runTransaction(
    async (transaction) => {
      const latestPairingSnap =
        await transaction.get(
          pairingRef
        );

      if (
        !latestPairingSnap.exists
      ) {
        throw new Error(
          "LINE連携コードが見つかりません。"
        );
      }

      const latest =
        latestPairingSnap.data() || {};

      const latestExpiry =
        latest.expiresAt?.toMillis
          ? latest.expiresAt.toMillis()
          : 0;

      if (
        latest.status !== "pending" ||
        latestExpiry <= Date.now()
      ) {
        throw new Error(
          "LINE連携コードが使用済み、または期限切れです。"
        );
      }

      transaction.set(
        settingsRef,
        {
          lineGroupId:
            groupId,
          lineGroupName:
            groupName,
          lineConnectedAt:
            FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      transaction.set(
        pairingRef,
        {
          status:
            "connected",
          groupId,
          groupName,
          connectedAt:
            FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        }
      );
    }
  );

  await replyLineMessage(
    event.replyToken,
    `✅ 営業実績アプリと「${groupName}」を連携しました。未報告通知の送信先として登録されています。`
  );
}

exports.lineWebhook = onRequest(
  {
    secrets: [
      "LINE_CHANNEL_SECRET",
      "LINE_CHANNEL_ACCESS_TOKEN",
    ],
  },
  async (request, response) => {
    if (
      request.method !== "POST"
    ) {
      response
        .status(405)
        .send("Method Not Allowed");
      return;
    }

    const signature =
      request.get(
        "x-line-signature"
      ) || "";

    if (
      !verifyLineWebhookSignature(
        request.rawBody,
        signature
      )
    ) {
      response
        .status(401)
        .send("Invalid signature");
      return;
    }

    const events =
      Array.isArray(
        request.body?.events
      )
        ? request.body.events
        : [];

    for (const event of events) {
      try {
        await handleLinePairingEvent(
          event
        );
      } catch (error) {
        console.error(
          "LINE Webhook処理エラー:",
          error
        );

        try {
          await replyLineMessage(
            event?.replyToken,
            "LINE連携処理に失敗しました。アプリから新しい連携コードを発行して、もう一度お試しください。"
          );
        } catch (replyError) {
          console.error(
            "LINEエラー返信失敗:",
            replyError
          );
        }
      }
    }

    response
      .status(200)
      .send("OK");
  }
);


/* =====================================================
   未報告班 LINE 自動通知
===================================================== */

function tokyoDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: weekdayMap[parts.weekday],
  };
}

function memberTeamForDate(member, date) {
  const history = Array.isArray(member?.teamHistory)
    ? member.teamHistory
        .filter(
          (item) =>
            item &&
            typeof item.effectiveDate === "string"
        )
        .sort((a, b) =>
          a.effectiveDate.localeCompare(b.effectiveDate)
        )
    : [];

  if (history.length === 0) {
    return member?.teamId || null;
  }

  let teamId = history[0].fromTeamId ?? null;

  for (const change of history) {
    if (change.effectiveDate <= date) {
      teamId = change.toTeamId ?? null;
    }
  }

  return teamId;
}

async function getMissingTeamReports(
  companyId,
  date,
  reportCompletionMode = "individual"
) {
  const [membersSnap, teamsSnap, recordsSnap] = await Promise.all([
    db
      .collection("companies")
      .doc(companyId)
      .collection("members")
      .get(),
    db
      .collection("teams")
      .where("companyId", "==", companyId)
      .get(),
    db
      .collection("records")
      .where("companyId", "==", companyId)
      .where("date", "==", date)
      .get(),
  ]);

  const teamNames = new Map();

  teamsSnap.forEach((teamDoc) => {
    const data = teamDoc.data() || {};
    teamNames.set(
      teamDoc.id,
      String(data.name || "班")
    );
  });

  const membersById = new Map();

  membersSnap.forEach((memberDoc) => {
    membersById.set(
      memberDoc.id,
      memberDoc.data() || {}
    );
  });

  const reportedUids = new Set();
  const reportedTeamIds = new Set();

  recordsSnap.forEach((recordDoc) => {
    const data = recordDoc.data() || {};

    if (data.uid) {
      reportedUids.add(
        String(data.uid)
      );
    }

    let teamId =
      data.teamId
        ? String(data.teamId)
        : "";

    if (
      !teamId &&
      data.uid
    ) {
      const member =
        membersById.get(
          String(data.uid)
        );

      teamId =
        member
          ? String(
              memberTeamForDate(
                member,
                date
              ) || ""
            )
          : "";
    }

    if (teamId) {
      reportedTeamIds.add(
        teamId
      );
    }
  });

  const summary = new Map();

  membersSnap.forEach((memberDoc) => {
    const member = memberDoc.data() || {};

    if (member.active === false) {
      return;
    }

    const teamId =
      String(
        memberTeamForDate(
          member,
          date
        ) || ""
      );

    if (!teamId) {
      return;
    }

    if (!summary.has(teamId)) {
      summary.set(teamId, {
        teamId,
        teamName:
          teamNames.get(teamId) ||
          member.teamName ||
          "班",
        expected: 0,
        reported: 0,
        teamReported:
          reportedTeamIds.has(
            teamId
          ),
      });
    }

    const item = summary.get(teamId);

    item.expected += 1;

    if (
      reportedUids.has(
        memberDoc.id
      )
    ) {
      item.reported += 1;
    }
  });

  return Array.from(summary.values())
    .filter((item) => {
      if (item.expected <= 0) {
        return false;
      }

      if (
        reportCompletionMode ===
          "team_any"
      ) {
        return (
          item.teamReported !==
            true
        );
      }

      return (
        item.reported <
          item.expected
      );
    })
    .sort((a, b) =>
      a.teamName.localeCompare(
        b.teamName,
        "ja"
      )
    );
}

async function pushLineGroupMessage(groupId, text) {
  const token =
    process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

  if (!token) {
    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN が設定されていません。"
    );
  }

  const response = await fetch(
    "https://api.line.me/v2/bot/message/push",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: groupId,
        messages: [
          {
            type: "text",
            text,
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();

    const error = new Error(
      `LINE送信失敗: ${response.status} ${detail}`
    );

    error.status = response.status;

    throw error;
  }
}

async function pushLineGroupMessageWithRetry(
  groupId,
  text,
  maxAttempts = 3
) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    try {
      await pushLineGroupMessage(
        groupId,
        text
      );

      return attempt;
    } catch (error) {
      lastError = error;

      const status =
        Number(error?.status || 0);

      const retryable =
        status === 0 ||
        status === 429 ||
        status >= 500;

      error.lineSendAttempts =
        attempt;

      if (
        !retryable ||
        attempt >= maxAttempts
      ) {
        throw error;
      }

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            500 * 2 ** (attempt - 1)
          )
      );
    }
  }

  throw lastError;
}


function buildReminderOnlyMessage(
  missingTeams
) {
  const teamNames =
    Array.from(
      new Set(
        (
          Array.isArray(missingTeams)
            ? missingTeams
            : []
        )
          .map(
            (item) =>
              String(
                item?.teamName || ""
              ).trim()
          )
          .filter(Boolean)
      )
    );

  const message = [
    "⚠️ 実績入力リマインド",
    "本日の実績入力がまだ完了していない班があります。",
    teamNames.length > 0
      ? "対象：" +
        teamNames.join("・")
      : "対象班があります。",
    "",
    "アプリを確認し、実績入力または「実績なし」の報告をお願いします。",
  ].join("\n");

  const unsafeDetail =
    /[¥￥]|\d[\d,]*(?:円|件)|売上金額|獲得商材|商材別|成約件数|粗利|利益|単価/i;

  if (
    unsafeDetail.test(message)
  ) {
    throw new Error(
      "Reminder-only guard blocked a message containing sales/performance details"
    );
  }

  return message;
}

exports.sendMissingReportReminders = onSchedule(
  {
    schedule: "* * * * *",
    timeZone: "Asia/Tokyo",
    secrets: ["LINE_CHANNEL_ACCESS_TOKEN"],
  },
  async () => {
    const now = tokyoDateParts();

    const companiesSnap = await db
      .collection("companies")
      .get();

    for (const companyDoc of companiesSnap.docs) {
      const companyData =
        companyDoc.data() || {};

      if (companyData.active === false) {
        continue;
      }

      const companyId = companyDoc.id;

      const settingsRef = db
        .collection("companies")
        .doc(companyId)
        .collection("settings")
        .doc("notifications");

      const settingsSnap = await settingsRef.get();

      if (!settingsSnap.exists) {
        continue;
      }

      const settings = settingsSnap.data() || {};
      const weekdays = Array.isArray(settings.weekdays)
        ? settings.weekdays.map(Number)
        : [];

      if (
        settings.enabled !== true ||
        settings.lineEnabled !== true ||
        !settings.lineGroupId ||
        settings.time !== now.time ||
        !weekdays.includes(now.weekday)
      ) {
        continue;
      }

      const missingTeams =
        await getMissingTeamReports(
          companyId,
          now.date,
          settings.reportCompletionMode ===
            "team_any"
            ? "team_any"
            : "individual"
        );

      if (missingTeams.length === 0) {
        continue;
      }

      const dispatchKey = [
        companyId,
        now.date,
        now.time.replace(":", ""),
      ].join("_");

      const dispatchRef = db
        .collection("notificationDispatches")
        .doc(dispatchKey);

      try {
        await dispatchRef.create({
          companyId,
          date: now.date,
          time: now.time,
          status: "processing",
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        if (
          error?.code === 6 ||
          error?.code === "already-exists"
        ) {
          continue;
        }

        throw error;
      }

      const message =
        buildReminderOnlyMessage(
          missingTeams
        );

      try {
        const sendAttempts =
          await pushLineGroupMessageWithRetry(
            String(settings.lineGroupId),
            message
          );

        await dispatchRef.set(
          {
            status: "sent",
            message,
            sendAttempts,
            sentAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (error) {
        console.error(
          `LINE未報告通知エラー companyId=${companyId}`,
          error
        );

        await dispatchRef.set(
          {
            status: "failed",
            sendAttempts:
              Number(
                error?.lineSendAttempts ||
                1
              ),
            error:
              String(error?.message || error).slice(0, 1000),
            failedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  }
);
