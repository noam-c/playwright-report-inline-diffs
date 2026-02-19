/**
 * Client-side script injected into the Playwright HTML report.
 *
 * Reads diff data from window.__INLINE_SNAPSHOT_DIFFS__ (set by the reporter)
 * and appends inline expected/actual/diff image views beneath each failed test
 * row in the report's main test list.
 */
const testDiffs = window.__INLINE_SNAPSHOT_DIFFS__;
if (!testDiffs) throw new Error('inline-diffs.js: window.__INLINE_SNAPSHOT_DIFFS__ not set');

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function createFigure(label, src) {
  const fig = createElement('figure');
  fig.appendChild(createElement('figcaption', null, label));

  const img = createElement('img');
  img.src = src;
  img.onclick = () => img.classList.toggle('zoomed');
  fig.appendChild(img);

  return fig;
}

function renderSideBySide(contentArea, snapshot) {
  contentArea.replaceChildren();

  const images = createElement('div', 'inline-snapshot-images');
  images.appendChild(createFigure('Expected', snapshot.expected));
  images.appendChild(createFigure('Actual', snapshot.actual));
  contentArea.appendChild(images);
}

function renderSlider(contentArea, snapshot) {
  contentArea.replaceChildren();

  const wrapper = createElement('div', 'inline-snapshot-slider-container');

  const actualImg = createElement('img');
  actualImg.src = snapshot.actual;
  wrapper.appendChild(actualImg);

  const overlay = createElement('div', 'inline-snapshot-slider-overlay');
  overlay.style.width = '50%';
  wrapper.appendChild(overlay);

  const expectedImg = createElement('img');
  expectedImg.src = snapshot.expected;
  overlay.appendChild(expectedImg);

  // Match the expected overlay size to the actual image once it loads
  actualImg.onload = () => {
    expectedImg.style.width = actualImg.offsetWidth + 'px';
    expectedImg.style.height = actualImg.offsetHeight + 'px';
  };

  const slider = Object.assign(createElement('input'), {
    type: 'range',
    min: '0',
    max: '100',
    value: '50',
    oninput() { overlay.style.width = this.value + '%'; },
  });
  wrapper.appendChild(slider);

  contentArea.appendChild(wrapper);
}

function renderDiff(contentArea, snapshot) {
  renderSingleImage(contentArea, 'Diff', snapshot.diff);
}

function renderSingleImage(contentArea, label, src) {
  const images = createElement('div', 'inline-snapshot-images');
  images.appendChild(createFigure(label, src));
  contentArea.replaceChildren(images);
}

const renderers = {
  'Diff': renderDiff,
  'Actual': (contentArea, snapshot) => renderSingleImage(contentArea, 'Actual', snapshot.actual),
  'Expected': (contentArea, snapshot) => renderSingleImage(contentArea, 'Expected', snapshot.expected),
  'Side by side': renderSideBySide,
  'Slider': renderSlider,
};

function createDiffView(snapshot) {
  const container = createElement('div', 'inline-snapshot-diff');

  if (snapshot.name) {
    container.appendChild(createElement('div', 'inline-snapshot-diff-title', snapshot.name));
  }

  const modes = [
    ...(snapshot.diff ? ['Diff'] : []),
    'Actual', 'Expected', 'Side by side', 'Slider',
  ];
  let currentMode = modes[0];

  const toggle = createElement('div', 'inline-snapshot-toggle');
  const contentArea = createElement('div');

  function render() {
    toggle.innerHTML = '';

    for (const mode of modes) {
      const btn = createElement('button', mode === currentMode ? 'active' : '', mode);
      btn.onclick = () => { currentMode = mode; render(); };
      toggle.appendChild(btn);
    }

    renderers[currentMode](contentArea, snapshot);
  }

  container.appendChild(toggle);
  container.appendChild(contentArea);
  render();

  return container;
}

function injectDiffs() {
  const diffsByTestId = new Map(testDiffs.map(td => [td.testId, td]));
  const rows = document.querySelectorAll('.test-file-test:not(:has(.inline-snapshot-diffs))');

  rows.forEach(row => {
    const link = row.querySelector('a[href*="testId="]');
    if (!link) return;

    const testId = link.getAttribute('href').match(/testId=([^&]+)/)?.[1];
    if (!testId) return;

    const testData = diffsByTestId.get(decodeURIComponent(testId));
    if (!testData) return;

    const container = createElement('div', 'inline-snapshot-diffs');
    testData.diffs
      .map(createDiffView)
      .forEach(diffView => container.appendChild(diffView));

    row.appendChild(container);
  });
}

// The Playwright report is a React SPA — the test rows don't exist at page
// load. We use a MutationObserver to re-inject whenever the DOM updates.
function watchForDOMChanges() {
  const root = document.getElementById('root');

  if (root) {
    new MutationObserver(injectDiffs).observe(root, { childList: true, subtree: true });
    injectDiffs();
  } else {
    requestAnimationFrame(watchForDOMChanges);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', watchForDOMChanges);
} else {
  watchForDOMChanges();
}
