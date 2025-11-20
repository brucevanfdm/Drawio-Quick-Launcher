// content.js

const BUTTON_ID_PREFIX = 'drawio-launcher-btn-';

function isDrawioXml(text) {
    if (!text || text.length < 50) return false;
    return text.includes('<mxfile host="app.diagrams.net"') ||
        (text.includes('<mxGraphModel>') && text.includes('<root>'));
}

function createButton(xml) {
    const btn = document.createElement('button');
    btn.textContent = 'Open in Draw.io';
    btn.style.cssText = `
    float: right;
    margin: 8px;
    padding: 0 12px;
    height: 28px;
    line-height: 28px;
    font-size: 12px;
    background-color: #f08705;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    z-index: 1000;
    font-family: sans-serif;
    position: relative;
    white-space: nowrap;
    box-sizing: border-box;
  `;
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering code block selection
        chrome.runtime.sendMessage({ action: 'open_drawio', xml: xml });
    });
    return btn;
}

// Debounce function to limit frequent updates
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Set to track blocks that need processing
const pendingBlocks = new Set();

const processPendingBlocks = debounce(() => {
    pendingBlocks.forEach(block => {
        // If already processed successfully, skip (unless we want to support updates, but usually once is enough)
        if (block.dataset.drawioProcessed === 'true') return;

        const text = block.textContent;
        if (isDrawioXml(text)) {
            block.dataset.drawioProcessed = 'true';
            const btn = createButton(text);

            // Insert button
            btn.style.float = 'right';
            btn.style.marginRight = '8px';
            btn.style.marginTop = '8px';

            if (block.firstChild) {
                block.insertBefore(btn, block.firstChild);
            } else {
                block.appendChild(btn);
            }

            // Remove from pending once processed
            pendingBlocks.delete(block);
        }
    });
    // Clear any remaining (failed) blocks from the set to avoid memory leaks? 
    // No, we want to keep retrying if they are still being streamed.
    // But we should probably clear them if they are detached.
    // For now, simple set is fine, but let's clear the set after processing to avoid re-checking static failed blocks forever?
    // Actually, if it failed, we might want to check again later if more text arrives.
    // So we only remove from Set if SUCCESS.
    // But we need to clear the Set of *processed* items.
    // If it failed, we keep it? No, if it failed, we wait for next mutation to add it back.
    pendingBlocks.clear();
}, 1000); // Wait 1s after last change to process (good for streaming completion)

// Observer for dynamic content (SPA) and Streaming
const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;

    mutations.forEach(mutation => {
        // Check added nodes
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element
                // Check if it is a PRE or contains PRE
                if (node.tagName === 'PRE') {
                    pendingBlocks.add(node);
                    shouldProcess = true;
                } else if (node.querySelectorAll) {
                    const pres = node.querySelectorAll('pre');
                    pres.forEach(p => pendingBlocks.add(p));
                    if (pres.length > 0) shouldProcess = true;
                }
            } else if (node.nodeType === 3) { // Text node
                // If text added, check if parent is PRE
                const parent = node.parentElement;
                if (parent && parent.tagName === 'PRE') {
                    pendingBlocks.add(parent);
                    shouldProcess = true;
                }
                // Also check if parent is CODE inside PRE
                if (parent && parent.tagName === 'CODE') {
                    const grandParent = parent.parentElement;
                    if (grandParent && grandParent.tagName === 'PRE') {
                        pendingBlocks.add(grandParent);
                        shouldProcess = true;
                    }
                }
            }
        });

        // Check characterData changes (text updates)
        if (mutation.type === 'characterData') {
            const node = mutation.target;
            const parent = node.parentElement;
            if (parent && parent.tagName === 'PRE') {
                pendingBlocks.add(parent);
                shouldProcess = true;
            }
            if (parent && parent.tagName === 'CODE') {
                const grandParent = parent.parentElement;
                if (grandParent && grandParent.tagName === 'PRE') {
                    pendingBlocks.add(grandParent);
                    shouldProcess = true;
                }
            }
        }
    });

    if (shouldProcess) {
        processPendingBlocks();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true // Important for streaming text updates
});

// Initial pass
document.querySelectorAll('pre').forEach(pre => {
    pendingBlocks.add(pre);
});
processPendingBlocks();
