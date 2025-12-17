// background.js

// Create the context menu item when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "open-in-drawio",
        title: "Open in Draw.io",
        contexts: ["selection"],
        documentUrlPatterns: [
            "https://gemini.google.com/*",
            "https://aistudio.google.com/*",
            "https://chatgpt.com/*",
            "https://claude.ai/*",
            "https://chat.deepseek.com/*",
            "https://www.perplexity.ai/*",
            "https://aistudio.xiaomimimo.com/*"
        ]
    });
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'open_drawio') {
        // Process the diagram asynchronously
        processDiagram(request.content || request.xml, request.type || 'xml')
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                console.error('Error in processDiagram:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // CRITICAL: Keep the message channel open for async response
    }

    // Handle other message types
    return false;
});

// Handle the context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "open-in-drawio") {
        // Instead of using info.selectionText directly, ask the content script for the context
        // This allows us to get the full code block content if the user selected part of it
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: 'get_selection_context' }, (response) => {
                if (chrome.runtime.lastError) {
                    // Fallback if content script is not ready or error
                    console.warn("Content script error:", chrome.runtime.lastError);
                    if (info.selectionText) {
                        const type = detectTypeFromText(info.selectionText);
                        processDiagram(info.selectionText, type);
                    }
                } else if (response && response.content) {
                    processDiagram(response.content, response.type || 'xml');
                } else if (info.selectionText) {
                    // Fallback if no response content
                    const type = detectTypeFromText(info.selectionText);
                    processDiagram(info.selectionText, type);
                }
            });
        }
    }
});

function detectTypeFromText(text) {
    if (!text) return 'xml';

    // Mermaid keywords
    if (/^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)/.test(text)) {
        return 'mermaid';
    }

    // XML check
    if (text.includes('</mxfile>') || text.includes('</mxGraphModel>')) {
        return 'xml';
    }

    // Default to XML if unsure (or maybe we should default to nothing? But existing behavior was XML)
    return 'xml';
}

/**
 * Processes the content: opens Draw.io with XML or Mermaid
 * @param {string} content 
 * @param {string} type 'xml' or 'mermaid'
 */
async function processDiagram(content, type) {
    try {
        if (!content) return;

        if (type === 'mermaid') {
            // Mermaid: Use 'create' URL parameter with JSON
            // https://app.diagrams.net/?create={type:'mermaid',data:'...'}
            const config = {
                type: 'mermaid',
                data: content
            };
            const url = `https://app.diagrams.net/?create=${encodeURIComponent(JSON.stringify(config))}`;
            chrome.tabs.create({ url: url });
        } else {
            // XML: Use #R compression
            const xml = content.trim();

            // 1. Sanitize
            const sanitizedXml = sanitizeXml(xml);

            // 2. Compress the XML using deflate-raw
            const compressed = await compressData(sanitizedXml);

            // 3. Convert to Base64
            const base64 = arrayBufferToBase64(compressed);

            // 4. URL Encode
            // Draw.io #R format expects standard Base64 (deflate-raw).
            const url = `https://app.diagrams.net/#R${base64}`;

            chrome.tabs.create({ url: url });
        }

    } catch (error) {
        console.error("Error processing Draw.io diagram:", error);
    }
}

/**
 * Compresses a string using Deflate (Raw) format.
 * @param {string} str 
 * @returns {Promise<ArrayBuffer>}
 */
async function compressData(str) {
    const stream = new Blob([str]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream("deflate-raw"));
    return await new Response(compressedStream).arrayBuffer();
}

/**
 * Converts an ArrayBuffer to a Base64 string.
 * @param {ArrayBuffer} buffer 
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Sanitizes the XML string by escaping special characters in attributes and text content.
 * @param {string} xml 
 * @returns {string}
 */
function sanitizeXml(xml) {
    // Detect if the ampersand already starts a valid entity so we avoid double-escaping.
    function isPreEscapedEntity(source, index) {
        if (source[index] !== '&') return false;
        const semi = source.indexOf(';', index + 1);
        if (semi === -1) return false;

        const entityBody = source.slice(index + 1, semi);
        if (!entityBody) return false;

        return /^#x[0-9A-Fa-f]+$/.test(entityBody) ||
            /^#\d+$/.test(entityBody) ||
            /^[a-zA-Z][a-zA-Z0-9]+$/.test(entityBody);
    }

    // Determine if a quote character is likely the end of an attribute value.
    function isAttributeTerminator(nextChar) {
        return nextChar === undefined ||
            nextChar === '' ||
            nextChar === '>' ||
            nextChar === '/' ||
            nextChar === '?' ||
            /\s/.test(nextChar);
    }

    let result = '';
    let i = 0;
    const len = xml.length;

    // States
    const STATE_TEXT = 0;
    const STATE_TAG_OPEN = 1; // After <
    const STATE_TAG_NAME = 2; // Inside <tagName ...
    const STATE_ATTR_NAME = 3; // Inside <tagName attr=...
    const STATE_ATTR_VALUE_Q = 4; // Inside <tagName attr="..."
    const STATE_ATTR_VALUE_DQ = 5; // Inside <tagName attr='...'
    const STATE_COMMENT = 6; // Inside <!-- ... -->
    const STATE_CDATA = 7; // Inside <![CDATA[ ... ]]>

    let state = STATE_TEXT;

    while (i < len) {
        const char = xml[i];

        if (state === STATE_TEXT) {
            if (char === '<') {
                // Check for CDATA
                if (xml.startsWith('<![CDATA[', i)) {
                    state = STATE_CDATA;
                    result += '<![CDATA[';
                    i += 9;
                    continue;
                }
                // Check for Comment
                if (xml.startsWith('<!--', i)) {
                    state = STATE_COMMENT;
                    result += '<!--';
                    i += 4;
                    continue;
                }
                // Check if it's a valid tag start (alpha or / or ? or !)
                // A loose check: next char should be a-z, A-Z, _, :, /, ?, !
                const nextChar = i + 1 < len ? xml[i + 1] : '';
                if (/[a-zA-Z0-9_:\/\?!]/.test(nextChar)) {
                    state = STATE_TAG_OPEN;
                    result += char;
                } else {
                    // It's a loose < in text, escape it
                    result += '&lt;';
                }
            } else if (char === '&') {
                result += isPreEscapedEntity(xml, i) ? '&' : '&amp;';
            } else if (char === '>') {
                // Loose > in text, escape it
                result += '&gt;';
            } else {
                result += char;
            }
        }
        else if (state === STATE_TAG_OPEN) {
            result += char;
            if (/\s/.test(char)) {
                state = STATE_TAG_NAME;
            } else if (char === '>') {
                state = STATE_TEXT;
            } else {
                state = STATE_TAG_NAME;
            }
        }
        else if (state === STATE_TAG_NAME) {
            result += char;
            if (/\s/.test(char)) {
                state = STATE_ATTR_NAME;
            } else if (char === '>') {
                state = STATE_TEXT;
            }
        }
        else if (state === STATE_ATTR_NAME) {
            result += char;
            if (char === '"') {
                state = STATE_ATTR_VALUE_DQ;
            } else if (char === "'") {
                state = STATE_ATTR_VALUE_Q;
            } else if (char === '>') {
                state = STATE_TEXT;
            }
        }
        else if (state === STATE_ATTR_VALUE_DQ) {
            if (char === '"') {
                const nextChar = i + 1 < len ? xml[i + 1] : '';
                if (isAttributeTerminator(nextChar)) {
                    state = STATE_ATTR_NAME;
                    result += char;
                } else {
                    result += '&quot;';
                }
            } else if (char === '&') {
                result += isPreEscapedEntity(xml, i) ? '&' : '&amp;';
            } else if (char === '<') {
                result += '&lt;';
            } else if (char === '>') {
                result += '&gt;';
            } else {
                result += char;
            }
        }
        else if (state === STATE_ATTR_VALUE_Q) {
            if (char === "'") {
                const nextChar = i + 1 < len ? xml[i + 1] : '';
                if (isAttributeTerminator(nextChar)) {
                    state = STATE_ATTR_NAME;
                    result += char;
                } else {
                    result += '&apos;';
                }
            } else if (char === '&') {
                result += isPreEscapedEntity(xml, i) ? '&' : '&amp;';
            } else if (char === '<') {
                result += '&lt;';
            } else if (char === '>') {
                result += '&gt;';
            } else {
                result += char;
            }
        }
        else if (state === STATE_COMMENT) {
            result += char;
            if (char === '>' && result.endsWith('-->')) {
                state = STATE_TEXT;
            }
        }
        else if (state === STATE_CDATA) {
            result += char;
            if (char === '>' && result.endsWith(']]>')) {
                state = STATE_TEXT;
            }
        }

        i++;
    }
    return result;
}
