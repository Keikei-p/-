/* ========================================
   営業実績管理
   JavaScript
======================================== */


/* ========================================
   データ
======================================== */

let items =
  JSON.parse(
    localStorage.getItem("salesItems")
  ) || [];


let members =
  JSON.parse(
    localStorage.getItem("salesMembers")
  ) || [];


let dailyRecords =
  JSON.parse(
    localStorage.getItem("salesDailyRecords")
  ) || {};


/* ========================================
   現在の月
======================================== */

let currentMonth = new Date();


/* ========================================
   要素
======================================== */

const itemModal =
  document.getElementById("itemModal");

const memberModal =
  document.getElementById("memberModal");

const dailyModal =
  document.getElementById("dailyModal");


/* ========================================
   保存
======================================== */

function saveData() {

  localStorage.setItem(
    "salesItems",
    JSON.stringify(items)
  );


  localStorage.setItem(
    "salesMembers",
    JSON.stringify(members)
  );


  localStorage.setItem(
    "salesDailyRecords",
    JSON.stringify(dailyRecords)
  );

}


/* ========================================
   日付キー
======================================== */

function getDateKey(date) {

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");


  return `${year}-${month}-${day}`;

}


/* ========================================
   月キー
======================================== */

function getMonthKey() {

  const year =
    currentMonth.getFullYear();

  const month =
    String(
      currentMonth.getMonth() + 1
    ).padStart(2, "0");


  return `${year}-${month}`;

}


/* ========================================
   今日の日付
======================================== */

function getTodayKey() {

  return getDateKey(
    new Date()
  );

}


/* ========================================
   月表示
======================================== */

function updateMonth() {

  const year =
    currentMonth.getFullYear();

  const month =
    currentMonth.getMonth() + 1;


  document
    .getElementById("currentYear")
    .textContent =
      `${year}年`;


  document
    .getElementById("currentMonth")
    .textContent =
      `${month}月`;


  updateSummary();

  renderItems();

  renderTodaySummary();

}


/* ========================================
   月移動
======================================== */

document
  .getElementById("prevMonth")
  .addEventListener(
    "click",
    () => {

      currentMonth.setMonth(
        currentMonth.getMonth() - 1
      );

      updateMonth();

    }
  );


document
  .getElementById("nextMonth")
  .addEventListener(
    "click",
    () => {

      currentMonth.setMonth(
        currentMonth.getMonth() + 1
      );

      updateMonth();

    }
  );


/* ========================================
   商材追加モーダル
======================================== */

function openItemModal() {

  itemModal.classList.add(
    "active"
  );

}


function closeItemModal() {

  itemModal.classList.remove(
    "active"
  );

}


document
  .getElementById("addItemButton")
  .addEventListener(
    "click",
    openItemModal
  );


document
  .getElementById("emptyAddButton")
  .addEventListener(
    "click",
    openItemModal
  );


document
  .getElementById("closeItemModal")
  .addEventListener(
    "click",
    closeItemModal
  );


/* ========================================
   商材追加
======================================== */

document
  .getElementById("saveItem")
  .addEventListener(
    "click",
    () => {

      const name =
        document
          .getElementById("itemName")
          .value
          .trim();


      const target =
        Number(
          document
            .getElementById("itemTarget")
            .value
        );


      const revenue =
        Number(
          document
            .getElementById("itemRevenue")
            .value
        );


      if (!name) {

        alert(
          "商材名を入力してください。"
        );

        return;

      }


      if (target <= 0) {

        alert(
          "月間目標を入力してください。"
        );

        return;

      }


      if (revenue < 0) {

        alert(
          "収益を正しく入力してください。"
        );

        return;

      }


      items.push({

        id: Date.now(),

        name: name,

        target: target,

        revenue: revenue

      });


      saveData();

      renderItems();

      updateSummary();

      closeItemModal();


      document
        .getElementById("itemName")
        .value = "";


      document
        .getElementById("itemTarget")
        .value = "";


      document
        .getElementById("itemRevenue")
        .value = "";

    }
  );


/* ========================================
   商材表示
======================================== */

function getMonthlyItemActual(
  itemId
) {

  const monthKey =
    getMonthKey();


  let total = 0;


  Object
    .keys(dailyRecords)
    .forEach(dateKey => {

      if (
        dateKey.startsWith(
          monthKey
        )
      ) {

        const day =
          dailyRecords[dateKey];


        Object
          .values(day)
          .forEach(memberData => {

            total +=
              Number(
                memberData[itemId]
              ) || 0;

          });

      }

    });


  return total;

}


function renderItems() {

  const itemList =
    document.getElementById(
      "itemList"
    );


  if (items.length === 0) {

    itemList.innerHTML = `

      <div class="empty-state">

        <div class="empty-icon">
          ＋
        </div>

        <h3>
          まだ商材がありません
        </h3>

        <p>
          商材を追加すると<br>
          ここに実績が表示されます。
        </p>

        <button id="emptyAddButton">
          商材を追加する
        </button>

      </div>

    `;


    document
      .getElementById(
        "emptyAddButton"
      )
      .addEventListener(
        "click",
        openItemModal
      );


    return;

  }


  itemList.innerHTML = "";


  items.forEach(item => {

    const actual =
      getMonthlyItemActual(
        item.id
      );


    const rate =
      item.target > 0
        ? Math.round(
            (actual /
              item.target) *
              100
          )
        : 0;


    const remaining =
      Math.max(
        item.target -
          actual,
        0
      );


    const card =
      document.createElement(
        "div"
      );


    card.className =
      "item-card";


    card.innerHTML = `

      <div class="item-top">

        <span class="item-name">
          ${escapeHtml(item.name)}
        </span>

        <span class="item-count">
          ${actual} / ${item.target}件
        </span>

      </div>


      <div class="item-progress">

        <div
          class="item-progress-value"
          style="width:
            ${Math.min(rate,100)}%">
        </div>

      </div>


      <div class="item-bottom">

        <span>
          達成率 ${rate}%
        </span>

        <span>
          残り ${remaining}件
        </span>

      </div>

    `;


    itemList.appendChild(
      card
    );

  });

}


/* ========================================
   全体集計
======================================== */

function updateSummary() {

  let total = 0;

  let target = 0;

  let revenue = 0;


  items.forEach(item => {

    const actual =
      getMonthlyItemActual(
        item.id
      );


    total += actual;

    target +=
      Number(item.target);


    revenue +=
      actual *
      Number(item.revenue);

  });


  const remaining =
    Math.max(
      target -
        total,
      0
    );


  const rate =
    target > 0
      ? Math.round(
          (total /
            target) *
            100
        )
      : 0;


  document
    .getElementById(
      "totalCount"
    )
    .textContent =
      total;


  document
    .getElementById(
      "targetCount"
    )
    .textContent =
      target;


  document
    .getElementById(
      "totalRevenue"
    )
    .textContent =
      `¥${revenue.toLocaleString()}`;


  document
    .getElementById(
      "remainingCount"
    )
    .textContent =
      `${remaining}件`;


  document
    .getElementById(
      "achievementRate"
    )
    .textContent =
      `${rate}%`;


  document
    .getElementById(
      "progressBar"
    )
    .style.width =
      `${Math.min(rate,100)}%`;

}


/* ========================================
   メンバー追加
======================================== */

function openMemberModal() {

  memberModal.classList.add(
    "active"
  );

}


function closeMemberModal() {

  memberModal.classList.remove(
    "active"
  );

}


document
  .getElementById(
    "addMemberButton"
  )
  .addEventListener(
    "click",
    openMemberModal
  );


document
  .getElementById(
    "emptyMemberButton"
  )
  .addEventListener(
    "click",
    openMemberModal
  );


document
  .getElementById(
    "closeMemberModal"
  )
  .addEventListener(
    "click",
    closeMemberModal
  );


/* ========================================
   メンバー保存
======================================== */

document
  .getElementById(
    "saveMember"
  )
  .addEventListener(
    "click",
    () => {

      const name =
        document
          .getElementById(
            "memberName"
          )
          .value
          .trim();


      if (!name) {

        alert(
          "メンバー名を入力してください。"
        );

        return;

      }


      members.push({

        id: Date.now(),

        name: name

      });


      saveData();

      renderMembers();

      updateMemberSelect();

      closeMemberModal();


      document
        .getElementById(
          "memberName"
        )
        .value = "";

    }
  );


/* ========================================
   メンバー表示
======================================== */

function renderMembers() {

  const memberList =
    document.getElementById(
      "memberList"
    );


  if (members.length === 0) {

    memberList.innerHTML = `

      <div class="empty-state">

        <div class="empty-icon">
          ＋
        </div>

        <h3>
          まだメンバーがいません
        </h3>

        <p>
          メンバーを登録すると<br>
          誰が獲得したか管理できます。
        </p>

        <button id="emptyMemberButton">
          メンバーを追加する
        </button>

      </div>

    `;


    document
      .getElementById(
        "emptyMemberButton"
      )
      .addEventListener(
        "click",
        openMemberModal
      );


    return;

  }


  memberList.innerHTML = "";


  members.forEach(member => {

    const card =
      document.createElement(
        "div"
      );


    card.className =
      "member-card";


    card.innerHTML = `

      <span class="member-name">
        ${escapeHtml(member.name)}
      </span>

      <button
        class="member-delete"
        data-id="${member.id}">

        削除

      </button>

    `;


    memberList.appendChild(
      card
    );

  });


  document
    .querySelectorAll(
      ".member-delete"
    )
    .forEach(button => {

      button.addEventListener(
        "click",
        () => {

          const id =
            Number(
              button.dataset.id
            );


          const member =
            members.find(
              m => m.id === id
            );


          if (!member) {
            return;
          }


          const result =
            confirm(
              `${member.name}を削除しますか？`
            );


          if (!result) {
            return;
          }


          members =
            members.filter(
              m => m.id !== id
            );


          saveData();

          renderMembers();

          updateMemberSelect();

        }
      );

    });

}


/* ========================================
   今日の実績入力
======================================== */

function openDailyModal() {

  if (members.length === 0) {

    alert(
      "先にメンバーを登録してください。"
    );

    openMemberModal();

    return;

  }


  if (items.length === 0) {

    alert(
      "先に商材を登録してください。"
    );

    openItemModal();

    return;

  }


  updateMemberSelect();


  document
    .getElementById(
      "dailyDate"
    )
    .textContent =
      formatJapaneseDate(
        new Date()
      );


  dailyModal.classList.add(
    "active"
  );

}


function closeDailyModal() {

  dailyModal.classList.remove(
    "active"
  );

}


document
  .getElementById(
    "openDailyInput"
  )
  .addEventListener(
    "click",
    openDailyModal
  );


document
  .getElementById(
    "emptyDailyInput"
  )
  .addEventListener(
    "click",
    openDailyModal
  );


document
  .getElementById(
    "inputButton"
  )
  .addEventListener(
    "click",
    openDailyModal
  );


document
  .getElementById(
    "closeDailyModal"
  )
  .addEventListener(
    "click",
    closeDailyModal
  );


/* ========================================
   メンバー選択
======================================== */

function updateMemberSelect() {

  const select =
    document.getElementById(
      "dailyMember"
    );


  select.innerHTML = `

    <option value="">
      メンバーを選択
    </option>

  `;


  members.forEach(member => {

    const option =
      document.createElement(
        "option"
      );


    option.value =
      member.id;


    option.textContent =
      member.name;


    select.appendChild(
      option
    );

  });

}


document
  .getElementById(
    "dailyMember"
  )
  .addEventListener(
    "change",
    renderDailyInputs
  );


/* ========================================
   商材入力欄
======================================== */

function renderDailyInputs() {

  const memberId =
    Number(
      document
        .getElementById(
          "dailyMember"
        )
        .value
    );


  const container =
    document.getElementById(
      "dailyItemInputs"
    );


  if (!memberId) {

    container.innerHTML = `

      <div class="empty-input-message">

        メンバーを選択すると<br>
        商材入力欄が表示されます。

      </div>

    `;

    return;

  }


  const today =
    getTodayKey();


  const existing =
    dailyRecords[today]?.[
      memberId
    ] || {};


  container.innerHTML = "";


  items.forEach(item => {

    const row =
      document.createElement(
        "div"
      );


    row.className =
      "daily-item-row";


    row.innerHTML = `

      <span>
        ${escapeHtml(item.name)}
      </span>

      <input
        type="number"
        min="0"
        value="${existing[item.id] || 0}"
        data-item-id="${item.id}">

    `;


    container.appendChild(
      row
    );

  });

}


/* ========================================
   今日の実績保存
======================================== */

document
  .getElementById(
    "saveDaily"
  )
  .addEventListener(
    "click",
    () => {

      const memberId =
        Number(
          document
            .getElementById(
              "dailyMember"
            )
            .value
        );


      if (!memberId) {

        alert(
          "メンバーを選択してください。"
        );

        return;

      }


      const today =
        getTodayKey();


      if (!dailyRecords[today]) {

        dailyRecords[today] = {};

      }


      if (!dailyRecords[today][memberId]) {

        dailyRecords[today][memberId] = {};

      }


      const inputs =
        document.querySelectorAll(
          "#dailyItemInputs input"
        );


      inputs.forEach(input => {

        const itemId =
          Number(
            input.dataset.itemId
          );


        const value =
          Number(
            input.value
          ) || 0;


        dailyRecords[today][
          memberId
        ][itemId] = value;

      });


      saveData();

      updateSummary();

      renderItems();

      renderTodaySummary();

      closeDailyModal();


      document
        .getElementById(
          "dailyMember"
        )
        .value = "";


      renderDailyInputs();

      alert(
        "今日の実績を保存しました。"
      );

    }
  );


/* ========================================
   今日の実績表示
======================================== */

function renderTodaySummary() {

  const container =
    document.getElementById(
      "todaySummary"
    );


  const today =
    getTodayKey();


  const todayData =
    dailyRecords[today];


  if (
    !todayData ||
    Object.keys(todayData).length === 0
  ) {

    container.innerHTML = `

      <div class="empty-state">

        <div class="empty-icon">
          ＋
        </div>

        <h3>
          今日の実績はまだありません
        </h3>

        <p>
          1日の最後に<br>
          メンバーごとの実績をまとめて入力できます。
        </p>

        <button id="emptyDailyInput">
          今日の実績を入力
        </button>

      </div>

    `;


    document
      .getElementById(
        "emptyDailyInput"
      )
      .addEventListener(
        "click",
        openDailyModal
      );


    return;

  }


  container.innerHTML = "";


  members.forEach(member => {

    const data =
      todayData[
        member.id
      ];


    if (!data) {
      return;
    }


    let total = 0;


    const rows = [];


    items.forEach(item => {

      const count =
        Number(
          data[item.id]
        ) || 0;


      if (count > 0) {

        total += count;


        rows.push(`

          <div class="today-item-row">

            <span>
              ${escapeHtml(item.name)}
            </span>

            <span class="today-item-count">
              ${count}件
            </span>

          </div>

        `);

      }

    });


    if (total === 0) {
      return;
    }


    const card =
      document.createElement(
        "div"
      );


    card.className =
      "today-person";


    card.innerHTML = `

      <div class="today-person-header">

        <span class="today-person-name">
          ${escapeHtml(member.name)}
        </span>

        <span class="today-person-total">
          合計 ${total}件
        </span>

      </div>


      <div class="today-items">

        ${rows.join("")}

      </div>

    `;


    container.appendChild(
      card
    );

  });


  if (
    container.children.length === 0
  ) {

    container.innerHTML = `

      <div class="empty-state">

        <h3>
          今日はまだ獲得実績がありません
        </h3>

      </div>

    `;

  }

}


/* ========================================
   日本語日付
======================================== */

function formatJapaneseDate(
  date
) {

  const year =
    date.getFullYear();

  const month =
    date.getMonth() + 1;

  const day =
    date.getDate();


  return `${year}年${month}月${day}日`;

}


/* ========================================
   HTML対策
======================================== */

function escapeHtml(
  text
) {

  const div =
    document.createElement(
      "div"
    );


  div.textContent =
    text;


  return div.innerHTML;

}


/* ========================================
   その他ボタン
======================================== */

document
  .getElementById(
    "performanceButton"
  )
  .addEventListener(
    "click",
    () => {

      alert(
        "個人実績画面は次のアップデートで作ります。"
      );

    }
  );


document
  .getElementById(
    "analysisButton"
  )
  .addEventListener(
    "click",
    () => {

      alert(
        "分析画面はこれから作ります。"
      );

    }
  );


document
  .getElementById(
    "settingsButton"
  )
  .addEventListener(
    "click",
    () => {

      alert(
        "設定画面はこれから作ります。"
      );

    }
  );


/* ========================================
   初期表示
======================================== */

renderItems();

renderMembers();

updateMemberSelect();

updateSummary();

renderTodaySummary();

updateMonth();
