/* ========================================
   営業実績管理
   JavaScript
======================================== */

const itemModal = document.getElementById("itemModal");

const addItemButton = document.getElementById("addItemButton");
const emptyAddButton = document.getElementById("emptyAddButton");
const closeModal = document.getElementById("closeModal");
const saveItem = document.getElementById("saveItem");

const itemName = document.getElementById("itemName");
const itemTarget = document.getElementById("itemTarget");
const itemRevenue = document.getElementById("itemRevenue");

const itemList = document.getElementById("itemList");

const totalCount = document.getElementById("totalCount");
const targetCount = document.getElementById("targetCount");
const totalRevenue = document.getElementById("totalRevenue");
const remainingCount = document.getElementById("remainingCount");
const achievementRate = document.getElementById("achievementRate");
const progressBar = document.getElementById("progressBar");


/* ========================================
   データ
======================================== */

let items = JSON.parse(
  localStorage.getItem("salesItems")
) || [];


/* ========================================
   モーダル
======================================== */

function openModal() {
  itemModal.classList.add("active");

  itemName.focus();
}

function closeItemModal() {
  itemModal.classList.remove("active");

  itemName.value = "";
  itemTarget.value = "";
  itemRevenue.value = "";
}


/* ========================================
   商材追加
======================================== */

function addItem() {

  const name = itemName.value.trim();
  const target = Number(itemTarget.value);
  const revenue = Number(itemRevenue.value);

  if (!name) {
    alert("商材名を入力してください。");
    return;
  }

  if (target <= 0) {
    alert("月間目標を入力してください。");
    return;
  }

  if (revenue < 0) {
    alert("収益を正しく入力してください。");
    return;
  }


  const newItem = {
    id: Date.now(),

    name: name,

    target: target,

    revenue: revenue,

    actual: 0
  };


  items.push(newItem);

  localStorage.setItem(
    "salesItems",
    JSON.stringify(items)
  );


  closeItemModal();

  renderItems();

  updateSummary();
}


/* ========================================
   商材表示
======================================== */

function renderItems() {

  if (items.length === 0) {

    itemList.innerHTML = `
      <div class="empty-state">

        <div class="empty-icon">＋</div>

        <h3>まだ商材がありません</h3>

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
      .getElementById("emptyAddButton")
      .addEventListener("click", openModal);

    return;
  }


  itemList.innerHTML = "";


  items.forEach(item => {

    const rate = item.target > 0
      ? Math.min(
          Math.round(
            (item.actual / item.target) * 100
          ),
          100
        )
      : 0;


    const remaining = Math.max(
      item.target - item.actual,
      0
    );


    const card = document.createElement("div");

    card.className = "item-card";


    card.innerHTML = `

      <div class="item-top">

        <span class="item-name">
          ${item.name}
        </span>

        <span class="item-count">
          ${item.actual} / ${item.target}件
        </span>

      </div>


      <div class="item-progress">

        <div
          class="item-progress-value"
          style="width: ${rate}%">
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


    itemList.appendChild(card);

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

    total += item.actual;

    target += item.target;

    revenue +=
      item.actual * item.revenue;

  });


  const remaining = Math.max(
    target - total,
    0
  );


  const rate = target > 0
    ? Math.round(
        (total / target) * 100
      )
    : 0;


  totalCount.textContent = total;

  targetCount.textContent = target;

  totalRevenue.textContent =
    `¥${revenue.toLocaleString()}`;

  remainingCount.textContent =
    `${remaining}件`;

  achievementRate.textContent =
    `${rate}%`;

  progressBar.style.width =
    `${Math.min(rate, 100)}%`;

}


/* ========================================
   月変更
======================================== */

let currentMonth = new Date();


function updateMonth() {

  const year =
    currentMonth.getFullYear();

  const month =
    currentMonth.getMonth() + 1;


  document.querySelector(
    ".month-display span"
  ).textContent = `${year}年`;


  document.querySelector(
    ".month-display strong"
  ).textContent = `${month}月`;

}


document
  .getElementById("prevMonth")
  .addEventListener("click", () => {

    currentMonth.setMonth(
      currentMonth.getMonth() - 1
    );

    updateMonth();

  });


document
  .getElementById("nextMonth")
  .addEventListener("click", () => {

    currentMonth.setMonth(
      currentMonth.getMonth() + 1
    );

    updateMonth();

  });


/* ========================================
   イベント
======================================== */

addItemButton.addEventListener(
  "click",
  openModal
);


emptyAddButton.addEventListener(
  "click",
  openModal
);


closeModal.addEventListener(
  "click",
  closeItemModal
);


saveItem.addEventListener(
  "click",
  addItem
);


/* モーダル外をクリック */

itemModal.addEventListener(
  "click",
  (event) => {

    if (event.target === itemModal) {
      closeItemModal();
    }

  }
);


/* ========================================
   初期表示
======================================== */

renderItems();

updateSummary();

updateMonth();
