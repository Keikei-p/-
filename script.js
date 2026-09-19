const STORAGE_KEY =
  "salesPerformanceApp_v2";


/* =========================
   データ
========================= */

const state =
  loadState();


function loadState() {

  const saved =
    localStorage.getItem(STORAGE_KEY);

  if (saved) {

    return JSON.parse(saved);

  }


  return {

    months: {

      [getMonthKey()]: {

        items: {},

        entries: []

      }

    }

  };

}


function saveState() {

  localStorage.setItem(

    STORAGE_KEY,

    JSON.stringify(state)

  );

}


/* =========================
   日付
========================= */

function getMonthKey(date = new Date()) {

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  return `${year}-${month}`;

}


function getToday() {

  const date =
    new Date();

  const offset =
    date.getTimezoneOffset();

  return new Date(
    date.getTime() -
    offset * 60000
  )
    .toISOString()
    .slice(0, 10);

}


/* =========================
   月データ
========================= */

function currentMonthData() {

  const key =
    getMonthKey();


  if (!state.months[key]) {

    state.months[key] = {

      items: {},

      entries: []

    };

  }


  return state.months[key];

}


/* =========================
   ID
========================= */

function createId() {

  return (

    Date.now() +

    "_" +

    Math.random()
      .toString(16)
      .slice(2)

  );

}


/* =========================
   通貨
========================= */

function formatYen(value) {

  return new Intl.NumberFormat(
    "ja-JP",
    {
      style: "currency",
      currency: "JPY",
      maximumFractionDigits: 0
    }
  ).format(value);

}


/* =========================
   商材計算
========================= */

function calculateItem(itemId) {

  const month =
    currentMonthData();

  const item =
    month.items[itemId];


  const count =
    month.entries

      .filter(
        entry =>
          entry.itemId === itemId
      )

      .reduce(
        (sum, entry) =>
          sum + entry.quantity,
        0
      );


  const revenue =
    count *
    item.unitRevenue;


  const remaining =
    Math.max(
      item.target - count,
      0
    );


  const rate =
    item.target > 0
      ? Math.min(
          (count / item.target) *
          100,
          100
        )
      : 0;


  return {

    count,

    revenue,

    target:
      item.target,

    remaining,

    rate

  };

}


/* =========================
   ホーム
========================= */

function renderHome() {

  const month =
    currentMonthData();


  const itemIds =
    Object.keys(
      month.items
    );


  let totalCount = 0;

  let totalRevenue = 0;

  let totalTarget = 0;


  itemIds.forEach(id => {

    const result =
      calculateItem(id);


    totalCount +=
      result.count;


    totalRevenue +=
      result.revenue;


    totalTarget +=
      result.target;

  });


  const overallRate =
    totalTarget > 0
      ? Math.min(
          (totalCount /
            totalTarget) *
            100,
          100
        )
      : 0;


  document.querySelector(
    "#monthButton"
  ).textContent =
    formatMonth(
      getMonthKey()
    );


  document.querySelector(
    "#totalRevenue"
  ).textContent =
    formatYen(
      totalRevenue
    );


  document.querySelector(
    "#totalCount"
  ).textContent =
    totalCount;


  document.querySelector(
    "#remainingCount"
  ).textContent =
    Math.max(
      totalTarget -
        totalCount,
      0
    );


  document.querySelector(
    "#itemCount"
  ).textContent =
    itemIds.length;


  document.querySelector(
    "#overallRate"
  ).textContent =
    `${Math.round(
      overallRate
    )}%`;


  document.querySelector(
    "#overallProgress"
  ).style.width =
    `${overallRate}%`;


  document.querySelector(
    "#overallTargetText"
  ).textContent =
    `${totalCount}件 / ${totalTarget}件`;


  renderItems(
    month,
    itemIds
  );


  renderEntrySelect(
    month,
    itemIds
  );

}


/* =========================
   商材一覧
========================= */

function renderItems(
  month,
  itemIds
) {

  const container =
    document.querySelector(
      "#itemsContainer"
    );


  container.innerHTML = "";


  if (
    itemIds.length === 0
  ) {

    container.innerHTML = `

      <div class="item-card">

        <strong>
          まだ商材がありません
        </strong>

        <p class="item-meta">

          「＋ 商材追加」から
          好きな商材を登録できます。

        </p>

      </div>

    `;

    return;

  }


  itemIds.forEach(id => {

    const item =
      month.items[id];


    const result =
      calculateItem(id);


    const card =
      document.createElement(
        "article"
      );


    card.className =
      "item-card";


    card.innerHTML = `

      <div class="item-top">

        <div>

          <div class="item-name">

            ${escapeHtml(
              item.name
            )}

          </div>

          <div class="item-meta">

            ${formatYen(
              item.unitRevenue
            )}
            / 1件

          </div>

        </div>


        <div class="item-count">

          ${result.count}件

        </div>

      </div>


      <div class="item-progress">

        <div
          style="
            width:${result.rate}%;
          "
        ></div>

      </div>


      <div class="item-bottom">

        <span>
          目標 ${result.target}件
        </span>

        <span>

          ${Math.round(
            result.rate
          )}%

          達成 ・ 残り
          ${result.remaining}件

        </span>

      </div>

    `;


    container.appendChild(
      card
    );

  });

}


/* =========================
   入力欄
========================= */

function renderEntrySelect(
  month,
  itemIds
) {

  const select =
    document.querySelector(
      "#entryItem"
    );


  select.innerHTML = "";


  if (
    itemIds.length === 0
  ) {

    select.innerHTML = `

      <option value="">
        先に商材を追加してください
      </option>

    `;

    return;

  }


  itemIds.forEach(id => {

    const option =
      document.createElement(
        "option"
      );


    option.value = id;


    option.textContent =
      month.items[id].name;


    select.appendChild(
      option
    );

  });

}


/* =========================
   個人実績
========================= */

function renderPerformance() {

  const month =
    currentMonthData();


  const itemIds =
    Object.keys(
      month.items
    );


  let totalCount = 0;

  let totalRevenue = 0;


  itemIds.forEach(id => {

    const result =
      calculateItem(id);


    totalCount +=
      result.count;


    totalRevenue +=
      result.revenue;

  });


  const dates =
    new Set(
      month.entries.map(
        entry =>
          entry.date
      )
    );


  const workDays =
    dates.size;


  const dailyAverage =
    workDays > 0

      ? (
          totalCount /
          workDays
        ).toFixed(1)

      : "0";


  document.querySelector(
    "#performanceCount"
  ).textContent =
    totalCount;


  document.querySelector(
    "#performanceRevenue"
  ).textContent =
    formatYen(
      totalRevenue
    );


  document.querySelector(
    "#dailyAverage"
  ).textContent =
    dailyAverage;


  const container =
    document.querySelector(
      "#performanceItems"
    );


  container.innerHTML = "";


  if (
    itemIds.length === 0
  ) {

    container.innerHTML = `

      <div class="history-empty">

        まだ商材が登録されていません。

      </div>

    `;

    return;

  }


  itemIds.forEach(id => {

    const item =
      month.items[id];


    const result =
      calculateItem(id);


    const card =
      document.createElement(
        "div"
      );


    card.className =
      "performance-item";


    card.innerHTML = `

      <div
        class="performance-item-top"
      >

        <span
          class="performance-item-name"
        >

          ${escapeHtml(
            item.name
          )}

        </span>


        <span
          class="performance-item-count"
        >

          ${result.count}件

        </span>

      </div>


      <div
        class="performance-item-revenue"
      >

        収益：
        ${formatYen(
          result.revenue
        )}

        ／

        目標：
        ${result.target}件

        ／

        達成率：
        ${Math.round(
          result.rate
        )}%

      </div>

    `;


    container.appendChild(
      card
    );

  });

}


/* =========================
   履歴
========================= */

function renderHistory() {

  const month =
    currentMonthData();


  const container =
    document.querySelector(
      "#historyList"
    );


  container.innerHTML = "";


  if (
    month.entries.length === 0
  ) {

    container.innerHTML = `

      <div class="history-empty">

        まだ実績がありません。

      </div>

    `;

    return;

  }


  const entries =
    [...month.entries]
      .sort(
        (a, b) =>
          b.date.localeCompare(
            a.date
          )
      );


  entries.forEach(entry => {

    const item =
      month.items[
        entry.itemId
      ];


    if (!item) return;


    const row =
      document.createElement(
        "div"
      );


    row.className =
      "history-item";


    row.innerHTML = `

      <div>

        <div class="history-date">

          ${formatDate(
            entry.date
          )}

        </div>


        <div class="history-name">

          ${escapeHtml(
            item.name
          )}

        </div>

      </div>


      <div class="history-quantity">

        +${entry.quantity}件

      </div>

    `;


    container.appendChild(
      row
    );

  });

}


/* =========================
   ページ切り替え
========================= */

function switchPage(
  page
) {

  document
    .querySelectorAll(
      ".page"
    )
    .forEach(element => {

      element.classList.remove(
        "active"
      );

    });


  document
    .querySelectorAll(
      ".tab"
    )
    .forEach(element => {

      element.classList.remove(
        "active"
      );

    });


  document
    .querySelector(
      `#${page}Page`
    )
    .classList.add(
      "active"
    );


  document
    .querySelector(
      `[data-page="${page}"]`
    )
    .classList.add(
      "active"
    );


  if (
    page === "performance"
  ) {

    renderPerformance();

  }


  if (
    page === "history"
  ) {

    renderHistory();

  }

}


/* =========================
   商材追加
========================= */

document
  .querySelector(
    "#itemForm"
  )
  .addEventListener(
    "submit",
    event => {

      event.preventDefault();


      const name =
        document.querySelector(
          "#itemName"
        ).value.trim();


      const target =
        Number(
          document.querySelector(
            "#itemTarget"
          ).value
        );


      const unitRevenue =
        Number(
          document.querySelector(
            "#itemRevenue"
          ).value
        );


      if (
        !name ||
        target < 0 ||
        unitRevenue < 0
      ) {

        return;

      }


      const month =
        currentMonthData();


      const id =
        createId();


      month.items[id] = {

        name,

        target,

        unitRevenue

      };


      saveState();


      closeModal();


      renderAll();

    }
  );


/* =========================
   実績登録
========================= */

document
  .querySelector(
    "#entryForm"
  )
  .addEventListener(
    "submit",
    event => {

      event.preventDefault();


      const month =
        currentMonthData();


      const itemId =
        document.querySelector(
          "#entryItem"
        ).value;


      const quantity =
        Number(
          document.querySelector(
            "#entryQuantity"
          ).value
        );


      const date =
        document.querySelector(
          "#entryDate"
        ).value;


      if (
        !itemId ||
        quantity < 1 ||
        !date
      ) {

        return;

      }


      month.entries.push({

        id:
          createId(),

        date,

        itemId,

        quantity

      });


      saveState();


      document.querySelector(
        "#entryQuantity"
      ).value = 1;


      renderAll();

    }
  );


/* =========================
   モーダル
========================= */

document
  .querySelector(
    "#addItemButton"
  )
  .addEventListener(
    "click",
    () => {

      document
        .querySelector(
          "#itemModal"
        )
        .classList.remove(
          "hidden"
        );

    }
  );


document
  .querySelectorAll(
    "[data-close-modal]"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        closeModal
      );

    }
  );


function closeModal() {

  document
    .querySelector(
      "#itemModal"
    )
    .classList.add(
      "hidden"
    );


  document
    .querySelector(
      "#itemForm"
    )
    .reset();

}


/* =========================
   タブ
========================= */

document
  .querySelectorAll(
    ".tab"
  )
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          switchPage(
            button.dataset.page
          );

        }
      );

    }
  );


/* =========================
   共通
========================= */

function renderAll() {

  renderHome();

  renderPerformance();

  renderHistory();

}


function formatMonth(
  key
) {

  const [
    year,
    month
  ] =
    key.split("-");


  return `${year}年${Number(month)}月`;

}


function formatDate(
  date
) {

  const [
    year,
    month,
    day
  ] =
    date.split("-");


  return `${year}/${month}/${day}`;

}


function escapeHtml(
  value
) {

  return String(value)

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );

}


/* =========================
   初期化
========================= */

document
  .querySelector(
    "#entryDate"
  )
  .value =
  getToday();


renderAll();
