// content.js

// Extension context validation - prevent stale content scripts
if (!chrome || !chrome.runtime || !chrome.runtime.id) {
    console.error('[Draw.io Launcher] Extension context is invalid. This content script is stale.');
    // Stop execution to prevent errors
    throw new Error('Extension context invalidated - content script is stale');
}

// Periodic health check for extension context (helps detect extension reloads)
let extensionContextValid = true;
const healthCheckInterval = setInterval(() => {
    try {
        // Try to access chrome.runtime.id - this will throw if context is invalid
        if (!chrome.runtime || !chrome.runtime.id) {
            extensionContextValid = false;
            clearInterval(healthCheckInterval);
            console.warn('[Draw.io Launcher] Extension context lost. Page refresh recommended.');
        }
    } catch (e) {
        extensionContextValid = false;
        clearInterval(healthCheckInterval);
        console.warn('[Draw.io Launcher] Extension context lost. Page refresh recommended.');
    }
}, 5000); // Check every 5 seconds

const BUTTON_ID_PREFIX = 'drawio-launcher-btn-';
const HOSTNAME = window.location.hostname;
const IS_CLAUDE = HOSTNAME.includes('claude.ai');
const IS_CHATGPT = HOSTNAME.includes('chatgpt.com') || HOSTNAME.includes('chat.openai.com');
const IS_AISTUDIO = HOSTNAME.includes('aistudio.google.com');
const IS_DEEPSEEK = HOSTNAME.includes('deepseek.com');
const IS_PERPLEXITY = HOSTNAME.includes('perplexity.ai');
const IS_XIAOMIMIMO = HOSTNAME.includes('xiaomimimo.com');

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

function getTextContentExcludingButtons(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList.contains('drawio-launcher-btn')) {
            return '';
        }
        let text = '';
        for (const child of node.childNodes) {
            text += getTextContentExcludingButtons(child);
        }
        return text;
    }
    return '';
}

function createButton(contentGetter, type) {
    const btn = document.createElement('button');
    btn.textContent = 'Open in Draw.io';
    btn.className = 'drawio-launcher-btn';

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
    btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent triggering code block selection
        const content = typeof contentGetter === 'function' ? contentGetter() : contentGetter;

        // Check extension context validity
        if (!extensionContextValid) {
            alert('🔄 Extension was reloaded.\n\nPlease refresh this page (F5) to continue using the buttons.');
            return;
        }

        // Critical check: Verify chrome.runtime is available
        if (!chrome || !chrome.runtime || !chrome.runtime.id) {
            extensionContextValid = false;
            console.error('[Draw.io Launcher] Extension runtime not available.');
            alert('🔄 Extension error: Runtime not available.\n\nPlease refresh this page (F5).');
            return;
        }

        try {
            // Use Promise-based approach for better error handling in MV3
            await chrome.runtime.sendMessage({
                action: 'open_drawio',
                content: content,
                type: type
            });
            console.log('[Draw.io Launcher] Successfully sent diagram to Draw.io');
        } catch (error) {
            console.error('[Draw.io Launcher] Failed to send message:', error);
            extensionContextValid = false;

            // User-friendly error message
            alert('🔄 Extension was reloaded or updated.\n\nPlease refresh this page (F5) to continue using the buttons.');
        }
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

    // For Perplexity, check if the code element is inside a .codeWrapper
    if (IS_PERPLEXITY && codeElement.closest('.codeWrapper')) {
        return true;
    }

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

    // Gemini: If the element is inside a CODE-BLOCK, skip it. 
    // The CODE-BLOCK itself will be processed (or has been processed) to add buttons in the header.
    if (preElement.closest('code-block')) {
        return false;
    }

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

        // Gemini: If block is inside a CODE-BLOCK but is NOT the CODE-BLOCK itself, skip it.
        if (block.tagName !== 'CODE-BLOCK' && block.closest('code-block')) {
            return;
        }

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
            // Safety check: Prevent duplicate buttons if they already exist in this block
            if (block.querySelector('.drawio-launcher-btn')) {
                processedBlocks.add(block);
                pendingBlocks.delete(block);
                return;
            }

            processedBlocks.add(block);

            // Check if we're on Claude.ai or Gemini for button positioning
            const isGemini = block.tagName === 'CODE-BLOCK';

            // Define content getter to retrieve latest text on click
            const getContent = () => getTextContentExcludingButtons(codeElement || block);

            if (IS_CLAUDE) {
                // Claude specific layout: Block layout (own line) using SPAN (phrasing content) to be valid inside CODE
                // ... (existing Claude logic) ...
                // Top Button Container
                const topContainer = document.createElement('span');
                topContainer.style.cssText = 'display: flex; justify-content: flex-start; margin-bottom: 8px; width: 100%;';

                const btnTop = createButton(getContent, type);
                // Override styles for block layout
                btnTop.style.float = 'none';
                btnTop.style.margin = '0';

                topContainer.appendChild(btnTop);

                // Bottom Button Container
                const bottomContainer = document.createElement('span');
                bottomContainer.style.cssText = 'display: flex; justify-content: flex-start; margin-top: 8px; width: 100%;';

                const btnBottom = createButton(getContent, type);
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

            } else if (IS_AISTUDIO) {
                // AI Studio specific layout: Insert into .mat-content in the expansion panel header
                const expansionPanel = block.closest('mat-expansion-panel');
                if (expansionPanel) {
                    const header = expansionPanel.querySelector('mat-expansion-panel-header');
                    if (header) {
                        const matContent = header.querySelector('.mat-content');
                        if (matContent) {
                            // Check if button already exists in matContent to avoid duplicates
                            if (!matContent.querySelector('.drawio-launcher-btn')) {
                                const btn = createButton(getContent, type);
                                // Style for AI Studio header
                                btn.style.float = 'none';
                                btn.style.marginLeft = '12px'; // Spacing from title
                                btn.style.height = '24px';
                                btn.style.lineHeight = '24px';
                                btn.style.fontSize = '12px';
                                btn.style.display = 'inline-block';
                                btn.style.verticalAlign = 'middle';

                                // Append to mat-content
                                matContent.appendChild(btn);
                            }
                        }
                    }
                }
            } else if (isGemini) {
                // Gemini specific layout: Insert into the header toolbar if possible
                const headerButtons = block.querySelector('.code-block-decoration .buttons');

                if (headerButtons) {
                    const btn = createButton(getContent, type);
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
                        const btn = createButton(getContent, type);
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
                        const btn = createButton(getContent, type);
                        btn.style.float = 'right';
                        btn.style.margin = '8px';
                        if (block.firstChild) {
                            block.insertBefore(btn, block.firstChild);
                        } else {
                            block.appendChild(btn);
                        }
                    }
                }
            } else if (IS_DEEPSEEK) {
                // DeepSeek specific layout: Insert into the code block banner toolbar
                const mdCodeBlock = block.closest('.md-code-block');
                if (mdCodeBlock) {
                    const banner = mdCodeBlock.querySelector('.md-code-block-banner');
                    if (banner) {
                        const buttonContainer = banner.querySelector('.d2a24f03:last-child .efa13877');
                        if (buttonContainer) {
                            // Check if button already exists to avoid duplicates
                            if (!buttonContainer.querySelector('.drawio-launcher-btn')) {
                                const btn = createButton(getContent, type);
                                // Style for DeepSeek header button
                                btn.style.float = 'none';
                                btn.style.margin = '0 4px 0 0';
                                btn.style.height = '24px';
                                btn.style.lineHeight = '24px';
                                btn.style.fontSize = '12px';
                                btn.style.display = 'inline-block';
                                btn.style.padding = '0 8px';

                                // Insert before first child to be leftmost
                                if (buttonContainer.firstChild) {
                                    buttonContainer.insertBefore(btn, buttonContainer.firstChild);
                                } else {
                                    buttonContainer.appendChild(btn);
                                }
                            }
                        }
                    }
                }
            } else if (IS_PERPLEXITY) {
                // Perplexity specific layout: Insert into the code block header with copy button
                // block could be CODE element, need to find the codeWrapper container
                let codeWrapper = null;
                if (block.classList && block.classList.contains('codeWrapper')) {
                    codeWrapper = block;
                } else {
                    codeWrapper = block.closest('.codeWrapper');
                }

                if (codeWrapper) {
                    // Find the button container (the div that contains the copy button)
                    const copyButton = codeWrapper.querySelector('button[data-testid="copy-code-button"]');

                    if (copyButton) {
                        // Find the parent container with bg-subtler class
                        const buttonContainer = copyButton.parentElement;

                        if (buttonContainer && !buttonContainer.querySelector('.drawio-launcher-btn')) {
                            const btn = createButton(getContent, type);
                            // Style for Perplexity header button - match their style
                            btn.style.float = 'none';
                            btn.style.margin = '0';
                            btn.style.height = '32px';
                            btn.style.lineHeight = '32px';
                            btn.style.fontSize = '12px';
                            btn.style.display = 'inline-block';
                            btn.style.padding = '0 12px';
                            btn.style.borderRadius = '9999px'; // Match rounded-full
                            btn.style.marginRight = '4px'; // Add some spacing

                            // Insert before the copy button
                            buttonContainer.insertBefore(btn, copyButton);
                        }
                    } else {
                        // Fallback: Insert at the top of codeWrapper if button container not found
                        if (!codeWrapper.querySelector('.drawio-launcher-btn')) {
                            const btn = createButton(getContent, type);
                            btn.style.position = 'absolute';
                            btn.style.right = '60px';
                            btn.style.top = '8px';
                            btn.style.float = 'none';
                            btn.style.zIndex = '10';

                            // Ensure codeWrapper has relative positioning
                            if (getComputedStyle(codeWrapper).position === 'static') {
                                codeWrapper.style.position = 'relative';
                            }
                            codeWrapper.appendChild(btn);
                        }
                    }
                }
            } else if (IS_XIAOMIMIMO) {
                // xiaomimimo.com specific layout: Insert into the header button container
                const preElement = block.tagName === 'CODE' ? block.closest('pre') : block;
                
                if (preElement) {
                    const header = preElement.closest('div')?.querySelector('header.flex.items-center');
                    
                    if (header) {
                        const buttonContainer = header.querySelector('div.flex.items-center.gap-2:last-child');
                        
                        if (buttonContainer && !buttonContainer.querySelector('.drawio-launcher-btn')) {
                            const btn = createButton(getContent, type);
                            // Style for xiaomimimo header button
                            btn.style.float = 'none';
                            btn.style.margin = '0';
                            btn.style.marginRight = '8px';
                            btn.style.height = '28px';
                            btn.style.lineHeight = '28px';
                            btn.style.fontSize = '12px';
                            btn.style.display = 'inline-block';
                            btn.style.padding = '0 12px';
                            btn.style.borderRadius = '6px';
                            btn.style.position = 'relative';
                            btn.style.outline = 'none';
                            btn.style.border = '1px solid transparent';
                            btn.style.whiteSpace = 'nowrap';
                            
                            // Insert before the first child (before the copy button)
                            if (buttonContainer.firstChild) {
                                buttonContainer.insertBefore(btn, buttonContainer.firstChild);
                            } else {
                                buttonContainer.appendChild(btn);
                            }
                        }
                    }
                }
            } else {
                // ChatGPT Layout: Insert button next to the copy button in the sticky header
                // Note: block could be CODE element, need to find the PRE parent first
                const preElement = block.tagName === 'CODE' ? block.closest('pre') : block;

                if (preElement) {
                    // .contain-inline-size is a CHILD of the PRE element
                    const container = preElement.querySelector('.contain-inline-size');
                    if (container) {
                        // Find the button container (bg-token-bg-elevated-secondary)
                        const buttonContainer = container.querySelector('.sticky .bg-token-bg-elevated-secondary');
                        if (buttonContainer) {
                            // Check if button already exists to avoid duplicates
                            if (!buttonContainer.querySelector('.drawio-launcher-btn')) {
                                const btn = createButton(getContent, type);
                                // Style for ChatGPT header button
                                btn.style.float = 'none';
                                btn.style.margin = '0';
                                btn.style.height = '24px';
                                btn.style.lineHeight = '24px';
                                btn.style.fontSize = '12px';
                                btn.style.display = 'inline-block';
                                btn.style.padding = '0 8px';

                                // Insert before the first button (copy button)
                                if (buttonContainer.firstChild) {
                                    buttonContainer.insertBefore(btn, buttonContainer.firstChild);
                                } else {
                                    buttonContainer.appendChild(btn);
                                }
                            }
                        } else {
                            // Fallback: use old float method if can't find button container
                            const btn = createButton(getContent, type);
                            btn.style.float = 'right';
                            btn.style.margin = '8px';
                            if (block.firstChild) {
                                block.insertBefore(btn, block.firstChild);
                            } else {
                                block.appendChild(btn);
                            }
                        }
                    } else {
                        // Ultimate fallback if no container found
                        const btn = createButton(getContent, type);
                        btn.style.float = 'right';
                        btn.style.margin = '8px';
                        if (block.firstChild) {
                            block.insertBefore(btn, block.firstChild);
                        } else {
                            block.appendChild(btn);
                        }
                    }
                }
            }


            // Remove from pending once processed successfully
            pendingBlocks.delete(block);
        } else {
            // If type detection failed (e.g., content not loaded yet),
            // keep the block in pendingBlocks for retry on next mutation
            // But only retry a limited number of times to avoid infinite loops
            if (!block._retryCount) {
                block._retryCount = 0;
            }
            block._retryCount++;

            // After 5 retries (5 x 100ms = 500ms), give up and remove it
            if (block._retryCount > 5) {
                pendingBlocks.delete(block);
            }
            // Otherwise, keep it in pendingBlocks for next attempt
        }
    });
    // Do NOT clear pendingBlocks - blocks that failed detection will be retried
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
                    } else if (tagName === 'DIV' || tagName === 'MAIN' || tagName === 'SECTION' || tagName === 'ARTICLE' || tagName === 'TD' ||
                        tagName === 'MS-CODE-BLOCK' || tagName === 'MAT-EXPANSION-PANEL' || tagName === 'MS-PROMPT-CHUNK' || tagName === 'MS-TEXT-CHUNK') {
                        // Only look inside container elements to avoid expensive queries on small elements (SPAN, A, etc.)

                        // For Perplexity, check if this is a codeWrapper
                        if (IS_PERPLEXITY && node.classList && node.classList.contains('codeWrapper')) {
                            const code = node.querySelector('code');
                            if (code && !processedBlocks.has(code)) {
                                pendingBlocks.add(code);
                                shouldProcess = true;
                            }
                        }

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
