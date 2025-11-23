// content.js

const BUTTON_ID_PREFIX = 'drawio-launcher-btn-';
const HOSTNAME = window.location.hostname;
const IS_CLAUDE = HOSTNAME.includes('claude.ai');
const IS_CHATGPT = HOSTNAME.includes('chatgpt.com') || HOSTNAME.includes('chat.openai.com');

function detectDiagramType(text, element) {
    if (!text || text.length < 10) return null;

    // Check for Mermaid
    // 1. Check class on the CODE element (most common)
    if (element && (element.classList.contains('language-mermaid') || element.classList.contains('mermaid'))) {
        return 'mermaid';
    }
    // 2. Check class on the PRE element (sometimes)
    const pre = element ? element.closest('pre') : null;
    if (pre && (pre.classList.contains('language-mermaid') || pre.classList.contains('mermaid'))) {
        return 'mermaid';
    }
    // 3. Heuristic check for Mermaid keywords if no class found (optional, but good for robustness)
    if (/^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)/.test(text)) {
        return 'mermaid';
    }

    // Check for Draw.io XML
    // 1. Check class on the CODE or PRE element
    if (element && (element.classList.contains('language-xml') || element.classList.contains('xml'))) {
        // Optional: Add a light check to ensure it's not just random XML
        if (text.includes('mxGraphModel') || text.includes('mxfile')) {
            return 'xml';
        }
    }
    const preXml = element ? element.closest('pre') : null;
    if (preXml && (preXml.classList.contains('language-xml') || preXml.classList.contains('xml'))) {
        if (text.includes('mxGraphModel') || text.includes('mxfile')) {
            return 'xml';
        }
    }

    // 2. Text check (relaxed)
    if (text.includes('</mxfile>') || text.includes('</mxGraphModel>')) {
        return 'xml';
    }

    return null;
}

function createButton(content, type) {
    const btn = document.createElement('button');
    btn.textContent = 'Open in Draw.io';

    // Check if we're on Claude.ai
    const floatDirection = IS_CLAUDE ? 'left' : 'right';

    btn.style.cssText = `
    float: ${floatDirection};
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
        chrome.runtime.sendMessage({ action: 'open_drawio', content: content, type: type });
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

// WeakSet to track already processed blocks (more performant than dataset)
const processedBlocks = new WeakSet();

// Helper function to check if a CODE element is relevant for our extension
function isRelevantCodeBlock(codeElement) {
    if (!codeElement) return false;

    // Always consider code-block elements as relevant for checking
    if (codeElement.tagName === 'CODE-BLOCK') return true;

    if (codeElement.tagName !== 'CODE') return false;

    const classes = codeElement.className || '';
    // Check for language classes that indicate XML or Mermaid
    return classes.includes('language-xml') ||
        classes.includes('language-mermaid') ||
        classes.includes('xml') ||
        classes.includes('mermaid');
}

// Prefer processing the CODE child for ChatGPT streaming blocks to avoid double inserts on PRE + CODE
function enqueuePreOrCode(preElement) {
    if (!preElement || processedBlocks.has(preElement)) return false;

    const codeChild = preElement.querySelector('code');
    if (IS_CHATGPT) {
        if (codeChild && !processedBlocks.has(codeChild)) {
            pendingBlocks.add(codeChild);
            return true;
        }
        // Wait for CODE to appear to avoid injecting twice on streaming updates
        return false;
    }

    if (codeChild && isRelevantCodeBlock(codeChild)) {
        if (!processedBlocks.has(codeChild)) {
            pendingBlocks.add(codeChild);
            return true;
        }
        return false;
    }

    if (!codeChild || !isRelevantCodeBlock(codeChild)) {
        pendingBlocks.add(preElement);
        return true;
    }

    return false;
}

const processPendingBlocks = debounce(() => {
    pendingBlocks.forEach(block => {
        // If already processed successfully, skip (unless we want to support updates, but usually once is enough)
        if (processedBlocks.has(block)) return;

        // Extract text and detect type
        let text, codeElement;

        if (block.tagName === 'CODE-BLOCK') {
            // Gemini: The text content of CODE-BLOCK includes headers like "Code snippet",
            // so we must extract text from the inner CODE element for accurate detection (especially for Mermaid regex which uses ^)
            const innerCode = block.querySelector('code');
            if (innerCode) {
                text = innerCode.textContent;
                codeElement = innerCode;
            } else {
                text = block.textContent;
                codeElement = block;
            }
        } else if (block.tagName === 'CODE') {
            // Standalone CODE element (e.g., Claude.ai)
            text = block.textContent;
            codeElement = block;
        } else {
            // PRE element (e.g., ChatGPT)
            codeElement = block.querySelector('code');
            text = codeElement ? codeElement.textContent : block.textContent;
        }

        const type = detectDiagramType(text, codeElement || block);

        if (type) {
            processedBlocks.add(block);

            // Check if we're on Claude.ai or Gemini for button positioning
            const isGemini = block.tagName === 'CODE-BLOCK';

            if (IS_CLAUDE) {
                // Claude specific layout: Block layout (own line) using SPAN (phrasing content) to be valid inside CODE
                // ... (existing Claude logic) ...
                // Top Button Container
                const topContainer = document.createElement('span');
                topContainer.style.cssText = 'display: flex; justify-content: flex-start; margin-bottom: 8px; width: 100%;';

                const btnTop = createButton(text, type);
                // Override styles for block layout
                btnTop.style.float = 'none';
                btnTop.style.margin = '0';

                topContainer.appendChild(btnTop);

                // Bottom Button Container
                const bottomContainer = document.createElement('span');
                bottomContainer.style.cssText = 'display: flex; justify-content: flex-start; margin-top: 8px; width: 100%;';

                const btnBottom = createButton(text, type);
                btnBottom.style.float = 'none';
                btnBottom.style.margin = '0';

                bottomContainer.appendChild(btnBottom);

                // Insert Top Container
                if (block.firstChild) {
                    block.insertBefore(topContainer, block.firstChild);
                } else {
                    block.appendChild(topContainer);
                }

                // Insert Bottom Container
                block.appendChild(bottomContainer);

            } else if (isGemini) {
                // Gemini specific layout: Insert into the header toolbar if possible
                const headerButtons = block.querySelector('.code-block-decoration .buttons');

                if (headerButtons) {
                    const btn = createButton(text, type);
                    // Override styles for Gemini header
                    btn.style.float = 'none';
                    btn.style.margin = '0 8px 0 0'; // Right margin to separate from copy button
                    btn.style.height = '24px'; // Slightly smaller to fit header
                    btn.style.lineHeight = '24px';
                    btn.style.fontSize = '11px';
                    btn.style.top = '-6px'

                    // Insert as first child of buttons container
                    if (headerButtons.firstChild) {
                        headerButtons.insertBefore(btn, headerButtons.firstChild);
                    } else {
                        headerButtons.appendChild(btn);
                    }
                } else {
                    // Fallback if no header found (e.g. unexpected structure)
                    // Try to insert inside the internal container to be "inside" the box
                    const internalContainer = block.querySelector('.formatted-code-block-internal-container');
                    if (internalContainer) {
                        const btn = createButton(text, type);
                        btn.style.position = 'absolute';
                        btn.style.right = '8px';
                        btn.style.top = '8px';
                        btn.style.float = 'none';

                        // Ensure container is relative
                        if (getComputedStyle(internalContainer).position === 'static') {
                            internalContainer.style.position = 'relative';
                        }
                        internalContainer.appendChild(btn);
                    } else {
                        // Ultimate fallback: Default float behavior on the block itself
                        const btn = createButton(text, type);
                        btn.style.float = 'right';
                        btn.style.margin = '8px';
                        if (block.firstChild) {
                            block.insertBefore(btn, block.firstChild);
                        } else {
                            block.appendChild(btn);
                        }
                    }
                }
            } else {
                // Default Layout (Float) for ChatGPT, etc.
                const floatDirection = 'right';

                // Create Top Button
                const btnTop = createButton(text, type);
                btnTop.style.float = floatDirection;
                btnTop.style.marginRight = '8px';
                btnTop.style.marginTop = '8px';

                // Create Bottom Button
                const btnBottom = createButton(text, type);
                btnBottom.style.float = floatDirection;
                btnBottom.style.marginRight = '8px';
                btnBottom.style.marginBottom = '8px';
                btnBottom.style.marginTop = '8px'; // Add some space from text

                // Insert Top Button
                if (block.firstChild) {
                    block.insertBefore(btnTop, block.firstChild);
                } else {
                    block.appendChild(btnTop);
                }

                // Insert Bottom Button
                block.appendChild(btnBottom);
            }

            // Remove from pending once processed
            pendingBlocks.delete(block);
        }
    });
    pendingBlocks.clear();
}, 100); // Wait 100ms after last change to process (faster response, still debounced)

// Observer for dynamic content (SPA) and Streaming
const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;

    for (const mutation of mutations) {
        // Check added nodes
        if (mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) { // Element
                    const tagName = node.tagName;

                    // Direct check for PRE or CODE
                    if (tagName === 'PRE') {
                        if (enqueuePreOrCode(node)) shouldProcess = true;
                    } else if (tagName === 'CODE-BLOCK') {
                        // Support for Gemini's code-block tag
                        if (!processedBlocks.has(node)) {
                            pendingBlocks.add(node);
                            shouldProcess = true;
                        }
                    } else if (tagName === 'CODE') {
                        // Early exit if already processed
                        if (processedBlocks.has(node)) continue;

                        if (IS_CHATGPT || isRelevantCodeBlock(node)) {
                            pendingBlocks.add(node);
                            shouldProcess = true;
                        }
                    } else if (tagName === 'DIV' || tagName === 'MAIN' || tagName === 'SECTION' || tagName === 'ARTICLE' || tagName === 'TD') {
                        // Only look inside container elements to avoid expensive queries on small elements (SPAN, A, etc.)

                        // Use getElementsByTagName (faster than querySelectorAll)
                        // Prioritize CODE elements
                        const codes = node.getElementsByTagName('code');
                        for (const code of codes) {
                            if (!processedBlocks.has(code) && (IS_CHATGPT || isRelevantCodeBlock(code))) {
                                pendingBlocks.add(code);
                                shouldProcess = true;
                            }
                        }

                        // Check PRE elements, but skip if they contain relevant CODE (to avoid duplicates)
                        const pres = node.getElementsByTagName('pre');
                        for (const pre of pres) {
                            if (enqueuePreOrCode(pre)) shouldProcess = true;
                        }
                    }
                } else if (node.nodeType === 3) { // Text node
                    // Optimization: Only check parent if it's likely a code block
                    const parent = node.parentElement;
                    if (parent) {
                        const parentTagName = parent.tagName;
                        if (parentTagName === 'PRE') {
                            if (enqueuePreOrCode(parent)) shouldProcess = true;
                        } else if (parentTagName === 'CODE') {
                            if (!processedBlocks.has(parent) && (IS_CHATGPT || isRelevantCodeBlock(parent))) {
                                pendingBlocks.add(parent);
                                shouldProcess = true;
                            }
                        } else if (parentTagName === 'SPAN' || parentTagName === 'DIV') {
                            // Sometimes text is inside a span inside a pre/code
                            const grandParent = parent.parentElement;
                            if (grandParent) {
                                if (grandParent.tagName === 'PRE') {
                                    if (enqueuePreOrCode(grandParent)) shouldProcess = true;
                                } else if (grandParent.tagName === 'CODE' && !processedBlocks.has(grandParent) && (IS_CHATGPT || isRelevantCodeBlock(grandParent))) {
                                    pendingBlocks.add(grandParent);
                                    shouldProcess = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        // Check characterData changes (text updates)
        if (mutation.type === 'characterData') {
            const node = mutation.target;
            const parent = node.parentElement;
            if (parent) {
                const parentTagName = parent.tagName;
                if (parentTagName === 'PRE') {
                    if (enqueuePreOrCode(parent)) shouldProcess = true;
                } else if (parentTagName === 'CODE-BLOCK') {
                    if (!processedBlocks.has(parent)) {
                        pendingBlocks.add(parent);
                        shouldProcess = true;
                    }
                } else if (parentTagName === 'CODE') {
                    if (!processedBlocks.has(parent) && (IS_CHATGPT || isRelevantCodeBlock(parent))) {
                        pendingBlocks.add(parent);
                        shouldProcess = true;
                    }
                }
            }
        }
    }

    if (shouldProcess) {
        processPendingBlocks();
    }
});

// Check if we're on Claude.ai - disable characterData observation for better performance
observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: !IS_CLAUDE // Disable for Claude.ai to improve code block expansion performance
});

// Initial pass
// Prioritize CODE and CODE-BLOCK elements
document.querySelectorAll('code, code-block').forEach(el => {
    if (IS_CHATGPT || isRelevantCodeBlock(el)) {
        pendingBlocks.add(el);
    }
});

// Check PRE elements, but skip if they contain relevant CODE (to avoid duplicates)
document.querySelectorAll('pre').forEach(pre => {
    enqueuePreOrCode(pre);
});
processPendingBlocks();

// Listen for context menu requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'get_selection_context') {
        const selection = window.getSelection();
        let content = selection.toString();
        let type = detectDiagramType(content);

        if (selection.rangeCount > 0) {
            const anchorNode = selection.anchorNode;
            if (anchorNode) {
                // Find parent PRE or CODE
                const element = anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement;
                const pre = element.closest('pre');

                if (pre) {
                    // If we are inside a PRE, try to get the full code content
                    const codeElement = pre.querySelector('code');
                    const fullText = codeElement ? codeElement.textContent : pre.textContent;

                    // Check if the selection is actually part of this block
                    // (Simple check: is the selected text contained in the full text?)
                    // A better check might be to see if the selection range intersects the pre

                    // For now, if we found a PRE, let's assume the user wants that block's content
                    // This fixes the "partial selection" or "formatted selection" issue
                    content = fullText;
                    type = detectDiagramType(content, codeElement || pre);
                }
            }
        }

        sendResponse({ content: content, type: type });
    }
});
