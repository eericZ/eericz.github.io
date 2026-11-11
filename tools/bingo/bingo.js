"use strict";

(() => {
  const SAVE_KEY = "bingo-game-state";
  const SAVE_VERSION = 1;

  const form = document.querySelector("#game-form");
  const fileInput = document.querySelector("#dataset-file");
  const seedInput = document.querySelector("#seed-input");
  const clearButton = document.querySelector("#clear-button");
  const datasetNameOutput = document.querySelector("#dataset-name");
  const notice = document.querySelector("#notice");
  const board = document.querySelector("#board");
  const emptyState = document.querySelector("#empty-state");
  const timer = document.querySelector("#timer");
  const activeSeedOutput = document.querySelector("#active-seed");
  const lineCount = document.querySelector("#line-count");
  const lineList = document.querySelector("#line-list");

  let dataset = null;
  let datasetName = "";
  let game = null;

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function fail(message) {
    throw new Error(message);
  }

  function validateDataset(value) {
    if (!isRecord(value)) {
      fail("The dataset must be a JSON object.");
    }
    if (!isRecord(value.grid)) {
      fail('The dataset needs a "grid" object.');
    }
    if (!Number.isSafeInteger(value.grid.size) || value.grid.size < 1) {
      fail('"grid.size" must be a positive whole number.');
    }

    const size = value.grid.size;
    const totalCells = size * size;
    if (!Number.isSafeInteger(totalCells)) {
      fail('"grid.size" is too large.');
    }

    const freeSpace = value.grid.freeSpace === undefined ? false : value.grid.freeSpace;
    if (typeof freeSpace !== "boolean") {
      fail('"grid.freeSpace" must be true or false.');
    }
    if (freeSpace && size % 2 === 0) {
      fail("A free center square requires an odd grid size.");
    }
    if (!isRecord(value.grid.tagCounts)) {
      fail('"grid.tagCounts" must be an object of tag counts.');
    }

    const tagCounts = Object.create(null);
    let requested = 0;
    for (const [tag, count] of Object.entries(value.grid.tagCounts)) {
      if (!tag.trim()) {
        fail("Tag names in grid.tagCounts cannot be empty.");
      }
      if (!Number.isSafeInteger(count) || count < 0) {
        fail(`The count for tag "${tag}" must be a non-negative whole number.`);
      }
      requested += count;
      if (!Number.isSafeInteger(requested)) {
        fail("The total tag count is too large.");
      }
      tagCounts[tag] = count;
    }

    const needed = totalCells - (freeSpace ? 1 : 0);
    if (requested !== needed) {
      fail(`The tag counts add up to ${requested}, but this grid needs exactly ${needed} dataset squares.`);
    }
    if (!Array.isArray(value.squares)) {
      fail('The dataset needs a "squares" array.');
    }

    const ids = new Set();
    const squares = value.squares.map((square, index) => {
      const label = `Square ${index + 1}`;
      if (!isRecord(square)) {
        fail(`${label} must be an object.`);
      }
      if (typeof square.id !== "string" || !square.id.trim()) {
        fail(`${label} needs a non-empty string id.`);
      }
      if (ids.has(square.id)) {
        fail(`Square id "${square.id}" is used more than once.`);
      }
      ids.add(square.id);
      if (typeof square.name !== "string" || !square.name.trim()) {
        fail(`Square "${square.id}" needs a non-empty name.`);
      }
      if (square.description !== undefined && typeof square.description !== "string") {
        fail(`The description for square "${square.id}" must be a string.`);
      }
      if (square.type !== "instant" && square.type !== "counter") {
        fail(`Square "${square.id}" has an unsupported type. Use "instant" or "counter".`);
      }
      if (typeof square.tag !== "string" || !square.tag.trim()) {
        fail(`Square "${square.id}" needs a non-empty string tag.`);
      }

      const normalized = {
        id: square.id,
        name: square.name,
        type: square.type,
        tag: square.tag,
      };
      if (square.description !== undefined) {
        normalized.description = square.description;
      }
      if (square.type === "counter") {
        if (!Number.isSafeInteger(square.amount) || square.amount < 1) {
          fail(`Counter square "${square.id}" needs a positive whole-number amount.`);
        }
        normalized.amount = square.amount;
      }
      return normalized;
    });

    for (const [tag, count] of Object.entries(tagCounts)) {
      if (count === 0) {
        continue;
      }
      const available = squares.reduce((total, square) => total + Number(square.tag === tag), 0);
      if (available < count) {
        fail(`Tag "${tag}" requests ${count} squares but only has ${available} unique square${available === 1 ? "" : "s"}.`);
      }
    }

    return {
      grid: { size, freeSpace, tagCounts },
      squares,
    };
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function random() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(items, random) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return items;
  }

  function randomSeed() {
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
      try {
        const seed = new Uint32Array(1);
        globalThis.crypto.getRandomValues(seed);
        return seed[0];
      } catch {
        return Math.floor(Math.random() * 0x100000000);
      }
    }
    return Math.floor(Math.random() * 0x100000000);
  }

  function makeCell(square) {
    return {
      ...square,
      free: false,
      progress: 0,
      validated: false,
      highlighted: false,
    };
  }

  function generateGrid(source, seed) {
    const { size, freeSpace, tagCounts } = source.grid;
    const random = mulberry32(seed);
    const chosen = [];

    for (const [tag, count] of Object.entries(tagCounts)) {
      const pool = shuffle(source.squares.filter((square) => square.tag === tag), random);
      chosen.push(...pool.slice(0, count));
    }
    shuffle(chosen, random);

    const totalCells = size * size;
    const freeIndex = freeSpace ? Math.floor(totalCells / 2) : -1;
    let selectedIndex = 0;
    const cells = Array.from({ length: totalCells }, (_, index) => {
      if (index === freeIndex) {
        return {
          id: "__bingo_free_space__",
          name: "Free space",
          type: "instant",
          tag: "",
          free: true,
          progress: 0,
          validated: true,
          highlighted: false,
        };
      }
      return makeCell(chosen[selectedIndex++]);
    });

    const newGame = {
      size,
      freeSpace,
      tagCounts: { ...tagCounts },
      seed,
      startedAt: Date.now(),
      cells,
      lineTimes: Object.create(null),
    };
    updateCompletedLines(newGame, Object.create(null), newGame.startedAt);
    return newGame;
  }

  function getLines(size) {
    const lines = [];
    for (let row = 0; row < size; row += 1) {
      lines.push({
        key: `row-${row + 1}`,
        label: `Row ${row + 1}`,
        indices: Array.from({ length: size }, (_, column) => row * size + column),
      });
    }
    for (let column = 0; column < size; column += 1) {
      lines.push({
        key: `column-${column + 1}`,
        label: `Column ${column + 1}`,
        indices: Array.from({ length: size }, (_, row) => row * size + column),
      });
    }
    lines.push({
      key: "diagonal-down",
      label: "Diagonal ↘",
      indices: Array.from({ length: size }, (_, index) => index * size + index),
    });
    lines.push({
      key: "diagonal-up",
      label: "Diagonal ↗",
      indices: Array.from({ length: size }, (_, index) => index * size + (size - index - 1)),
    });
    return lines;
  }

  function updateCompletedLines(target, previous, timestamp = Date.now()) {
    const next = Object.create(null);
    for (const line of getLines(target.size)) {
      const complete = line.indices.every((index) => target.cells[index].validated);
      if (complete) {
        next[line.key] = own(previous, line.key) ? previous[line.key] : timestamp;
      }
    }
    target.lineTimes = next;
  }

  function validateSavedGame(value) {
    if (!isRecord(value)) {
      fail("The saved game is not a valid object.");
    }
    const { size, freeSpace, seed, startedAt } = value;
    if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(size * size)) {
      fail("The saved grid size is invalid.");
    }
    if (typeof freeSpace !== "boolean" || (freeSpace && size % 2 === 0)) {
      fail("The saved free-space configuration is invalid.");
    }
    if (
      !Number.isSafeInteger(seed) ||
      !Number.isFinite(startedAt) ||
      !Number.isFinite(new Date(startedAt).getTime())
    ) {
      fail("The saved seed or start time is invalid.");
    }
    if (!isRecord(value.tagCounts)) {
      fail("The saved tag distribution is invalid.");
    }
    let countTotal = 0;
    for (const [tag, count] of Object.entries(value.tagCounts)) {
      if (!tag.trim() || !Number.isSafeInteger(count) || count < 0) {
        fail("The saved tag distribution contains an invalid entry.");
      }
      countTotal += count;
    }
    if (countTotal !== size * size - (freeSpace ? 1 : 0)) {
      fail("The saved tag distribution does not match the grid.");
    }
    if (!Array.isArray(value.cells) || value.cells.length !== size * size) {
      fail("The saved board has the wrong number of squares.");
    }

    const centerIndex = Math.floor((size * size) / 2);
    const ids = new Set();
    const cells = value.cells.map((cell, index) => {
      if (!isRecord(cell) || typeof cell.free !== "boolean") {
        fail(`Saved square ${index + 1} is invalid.`);
      }
      if (cell.description !== undefined && typeof cell.description !== "string") {
        fail(`Saved square ${index + 1} has an invalid description.`);
      }
      if (cell.free) {
        if (
          !freeSpace ||
          index !== centerIndex ||
          cell.id !== "__bingo_free_space__" ||
          cell.name !== "Free space" ||
          cell.type !== "instant" ||
          cell.tag !== "" ||
          cell.progress !== 0 ||
          cell.validated !== true ||
          typeof cell.highlighted !== "boolean"
        ) {
          fail("The saved free square is in the wrong position or is unvalidated.");
        }
        return { ...cell };
      }
      if (
        typeof cell.id !== "string" ||
        !cell.id ||
        ids.has(cell.id) ||
        typeof cell.name !== "string" ||
        (cell.type !== "instant" && cell.type !== "counter") ||
        typeof cell.tag !== "string" ||
        typeof cell.validated !== "boolean" ||
        typeof cell.highlighted !== "boolean"
      ) {
        fail(`Saved square ${index + 1} has invalid data.`);
      }
      ids.add(cell.id);
      if (cell.type === "counter") {
        if (!Number.isSafeInteger(cell.amount) || cell.amount < 1) {
          fail(`Saved counter square ${index + 1} has an invalid amount.`);
        }
        if (!Number.isSafeInteger(cell.progress) || cell.progress < 0 || cell.progress > cell.amount) {
          fail(`Saved counter square ${index + 1} has invalid progress.`);
        }
        if (cell.validated !== (cell.progress === cell.amount)) {
          fail(`Saved counter square ${index + 1} has inconsistent validation.`);
        }
      } else if (cell.progress !== 0) {
        fail(`Saved instant square ${index + 1} has invalid progress.`);
      }
      return { ...cell };
    });
    if (cells.filter((cell) => cell.free).length !== Number(freeSpace)) {
      fail("The saved board has an invalid free-space count.");
    }

    if (!isRecord(value.lineTimes)) {
      fail("The saved line times are invalid.");
    }
    const completed = new Set();
    for (const line of getLines(size)) {
      if (line.indices.every((index) => cells[index].validated)) {
        completed.add(line.key);
      }
    }
    const savedLineKeys = Object.keys(value.lineTimes);
    if (
      savedLineKeys.length !== completed.size ||
      savedLineKeys.some(
        (key) =>
          !completed.has(key) ||
          !Number.isFinite(value.lineTimes[key]) ||
          !Number.isFinite(new Date(value.lineTimes[key]).getTime()),
      )
    ) {
      fail("The saved line times do not match the completed lines.");
    }

    return {
      size,
      freeSpace,
      tagCounts: { ...value.tagCounts },
      seed,
      startedAt,
      cells,
      lineTimes: { ...value.lineTimes },
    };
  }

  function showNotice(message, kind = "") {
    notice.textContent = message;
    if (kind) {
      notice.dataset.kind = kind;
    } else {
      delete notice.dataset.kind;
    }
  }

  function persist() {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ version: SAVE_VERSION, dataset, datasetName, game }),
      );
      return true;
    } catch (error) {
      showNotice(`Could not save game progress: ${error.message}`, "error");
      return false;
    }
  }

  function restore() {
    let savedText;
    try {
      savedText = localStorage.getItem(SAVE_KEY);
    } catch (error) {
      showNotice(`Could not read saved game progress: ${error.message}`, "error");
      return;
    }
    if (savedText === null) {
      return;
    }

    try {
      const saved = JSON.parse(savedText);
      if (!isRecord(saved) || saved.version !== SAVE_VERSION) {
        fail("The saved game uses an unsupported format.");
      }
      if (saved.dataset !== null) {
        dataset = validateDataset(saved.dataset);
      } else {
        dataset = null;
      }
      if (typeof saved.datasetName !== "string") {
        fail("The saved dataset name is invalid.");
      }
      datasetName = saved.datasetName;
      game = saved.game === null ? null : validateSavedGame(saved.game);
      if (game) {
        seedInput.value = String(game.seed);
      }
      showNotice("Saved game restored.", "success");
    } catch (error) {
      dataset = null;
      datasetName = "";
      game = null;
      try {
        localStorage.removeItem(SAVE_KEY);
        showNotice(`The saved game could not be restored and was cleared: ${error.message}`, "error");
      } catch (removeError) {
        showNotice(
          `The saved game could not be restored: ${error.message}. It could not be removed from storage: ${removeError.message}`,
          "error",
        );
      }
    }
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours > 0) {
      return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
    }
    return [minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
  }

  function updateTimer() {
    timer.textContent = game ? formatDuration(Date.now() - game.startedAt) : "00:00";
  }

  function makeDescription(cell, index) {
    if (!cell.description) {
      return null;
    }
    const description = document.createElement("span");
    description.className = "description-popup";
    description.id = `square-description-${index}`;
    description.setAttribute("role", "tooltip");
    description.setAttribute("aria-hidden", "true");
    description.textContent = cell.description;
    return description;
  }

  function renderBoard() {
    const focusTarget = document.activeElement?.closest?.("#board [data-action]");
    const focusAction = focusTarget?.dataset.action;
    const focusIndex = focusTarget?.dataset.index;
    board.replaceChildren();

    if (!game) {
      board.hidden = true;
      emptyState.hidden = false;
      return;
    }

    board.hidden = false;
    emptyState.hidden = true;
    board.style.setProperty("--grid-size", String(game.size));
    board.setAttribute("aria-label", `${game.size} by ${game.size} bingo board`);
    game.cells.forEach((cell, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "bingo-cell";
      wrapper.setAttribute("role", "gridcell");
      wrapper.setAttribute("aria-rowindex", String(Math.floor(index / game.size) + 1));
      wrapper.setAttribute("aria-colindex", String((index % game.size) + 1));
      if (cell.validated) {
        wrapper.classList.add("is-validated");
      }
      if (cell.highlighted) {
        wrapper.classList.add("is-highlighted");
      }
      if (cell.free) {
        wrapper.classList.add("is-free");
      }

      const squareButton = document.createElement("button");
      squareButton.className = "square-button";
      squareButton.type = "button";
      squareButton.dataset.action = "toggle";
      squareButton.dataset.index = String(index);
      squareButton.setAttribute("aria-pressed", String(cell.validated));
      squareButton.disabled = cell.free;
      const accessibleState = cell.free
        ? "Free space, validated"
        : cell.type === "counter"
          ? `${cell.name}, ${cell.progress} of ${cell.amount}${cell.validated ? ", validated" : ""}`
          : `${cell.name}${cell.validated ? ", validated" : ", not validated"}`;
      squareButton.setAttribute(
        "aria-label",
        cell.description ? `${accessibleState}. ${cell.description}` : accessibleState,
      );

      const name = document.createElement("span");
      name.className = "square-name";
      name.textContent = cell.name;
      squareButton.append(name);

      if (cell.type === "counter" && !cell.free) {
        const progress = document.createElement("span");
        progress.className = "square-progress";
        progress.textContent = `${cell.progress} / ${cell.amount}`;
        squareButton.append(progress);
      } else if (cell.validated) {
        const check = document.createElement("span");
        check.className = "square-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = "✓";
        squareButton.append(check);
      }
      wrapper.append(squareButton);

      const tools = document.createElement("div");
      tools.className = "cell-tools";
      if (cell.description) {
        const infoButton = document.createElement("button");
        infoButton.className = "cell-tool";
        infoButton.type = "button";
        infoButton.dataset.action = "description";
        infoButton.dataset.index = String(index);
        infoButton.setAttribute("aria-label", `Show description for ${cell.name}`);
        infoButton.setAttribute("aria-expanded", "false");
        infoButton.setAttribute("aria-controls", `square-description-${index}`);
        infoButton.textContent = "i";
        tools.append(infoButton);
      }

      const highlightButton = document.createElement("button");
      highlightButton.className = "cell-tool";
      highlightButton.type = "button";
      highlightButton.dataset.action = "highlight";
      highlightButton.dataset.index = String(index);
      highlightButton.setAttribute("aria-pressed", String(cell.highlighted));
      highlightButton.setAttribute(
        "aria-label",
        `${cell.highlighted ? "Remove highlight from" : "Highlight"} ${cell.name}`,
      );
      highlightButton.textContent = "★";
      tools.append(highlightButton);
      wrapper.append(tools);

      const description = makeDescription(cell, index);
      if (description) {
        wrapper.append(description);
      }
      board.append(wrapper);
    });

    if (focusAction && focusIndex !== undefined) {
      board.querySelector(`[data-action="${focusAction}"][data-index="${focusIndex}"]`)?.focus();
    }
  }

  function renderLines() {
    lineList.replaceChildren();
    if (!game) {
      lineCount.textContent = "0";
      const empty = document.createElement("li");
      empty.className = "line-empty";
      empty.textContent = "No completed lines yet.";
      lineList.append(empty);
      return;
    }

    const lines = getLines(game.size).filter((line) => own(game.lineTimes, line.key));
    lineCount.textContent = String(lines.length);
    if (lines.length === 0) {
      const empty = document.createElement("li");
      empty.className = "line-empty";
      empty.textContent = "No completed lines yet.";
      lineList.append(empty);
      return;
    }
    for (const line of lines) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = line.label;
      const completedAt = document.createElement("time");
      const elapsed = formatDuration(game.lineTimes[line.key] - game.startedAt);
      completedAt.textContent = elapsed;
      completedAt.dateTime = new Date(game.lineTimes[line.key]).toISOString();
      completedAt.setAttribute("aria-label", `Completed at ${elapsed} elapsed`);
      item.append(label, completedAt);
      lineList.append(item);
    }
  }

  function render() {
    datasetNameOutput.textContent = dataset
      ? `Loaded dataset: ${datasetName || "Unnamed dataset"}`
      : "No dataset loaded";
    activeSeedOutput.textContent = game ? String(game.seed) : "—";
    updateTimer();
    renderBoard();
    renderLines();
  }

  function onBoardAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button || !board.contains(button) || !game) {
      return;
    }
    const index = Number(button.dataset.index);
    const cell = game.cells[index];
    if (!cell) {
      return;
    }

    if (button.dataset.action === "description") {
      const wrapper = button.closest(".bingo-cell");
      const open = wrapper.classList.toggle("show-description");
      button.setAttribute("aria-expanded", String(open));
      wrapper.querySelector(".description-popup")?.setAttribute("aria-hidden", String(!open));
      return;
    }
    if (button.dataset.action === "highlight") {
      cell.highlighted = !cell.highlighted;
    } else if (button.dataset.action === "toggle" && !cell.free) {
      if (cell.type === "counter") {
        cell.progress = cell.progress === cell.amount ? 0 : cell.progress + 1;
        cell.validated = cell.progress === cell.amount;
      } else {
        cell.validated = !cell.validated;
      }
    } else {
      return;
    }

    const previousTimes = game.lineTimes;
    updateCompletedLines(game, previousTimes);
    persist();
    render();
  }

  async function loadDataset(file) {
    let text;
    try {
      text = await file.text();
    } catch (error) {
      showNotice(`Could not read the selected file: ${error.message}`, "error");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      showNotice(`The selected file is not valid JSON: ${error.message}`, "error");
      return;
    }

    let validated;
    try {
      validated = validateDataset(parsed);
    } catch (error) {
      showNotice(error.message, "error");
      return;
    }

    dataset = validated;
    datasetName = file.name;
    const saved = persist();
    render();
    if (saved) {
      showNotice(`Loaded ${file.name}. Generate a grid when you're ready.`, "success");
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!dataset) {
      showNotice("Load a valid JSON dataset before generating a grid.", "error");
      return;
    }

    let seed;
    if (seedInput.value.trim() === "") {
      seed = randomSeed();
      seedInput.value = String(seed);
    } else {
      seed = Number(seedInput.value);
      if (!Number.isSafeInteger(seed)) {
        showNotice("The seed must be a whole number within the safe integer range.", "error");
        return;
      }
    }

    try {
      game = generateGrid(dataset, seed);
      const saved = persist();
      render();
      if (saved) {
        showNotice("New grid generated. Your progress is saved automatically.", "success");
      }
    } catch (error) {
      showNotice(`Could not generate the grid: ${error.message}`, "error");
    }
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file) {
      await loadDataset(file);
    }
    fileInput.value = "";
  });

  clearButton.addEventListener("click", () => {
    game = null;
    const saved = persist();
    render();
    if (saved) {
      showNotice(dataset ? "Game cleared. The loaded dataset is ready for another grid." : "Game cleared.", "success");
    }
  });

  board.addEventListener("click", onBoardAction);
  window.setInterval(updateTimer, 1000);
  restore();
  render();
})();
