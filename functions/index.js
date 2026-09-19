const crypto = require("crypto");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
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
