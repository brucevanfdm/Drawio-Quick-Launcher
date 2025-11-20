// background.js

// Create the context menu item when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "open-in-drawio",
        title: "Open in Draw.io",
        contexts: ["selection"],
        documentUrlPatterns: [
            "*://*.google.com/*",
            "*://*.chatgpt.com/*",
            "*://claude.ai/*",
            "<all_urls>" // Added for testing flexibility, can be restricted later
        ]
    });
});

// Handle the context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "open-in-drawio" && info.selectionText) {
        try {
            const xml = info.selectionText.trim();
            if (!xml) return;
            // 1. Compress the XML using deflate-raw
            const compressed = await compressData(xml);

            // 2. Convert to Base64
            const base64 = arrayBufferToBase64(compressed);

            // 3. URL Encode
            // Draw.io #R format expects standard Base64 (deflate-raw).
            const url = `https://app.diagrams.net/#R${base64}`;

            chrome.tabs.create({ url: url });

        } catch (error) {
            console.error("Error processing Draw.io XML:", error);
        }
    }
});

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
