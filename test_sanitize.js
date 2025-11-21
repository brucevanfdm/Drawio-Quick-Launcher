
function sanitizeXml(xml) {
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
            } else if (char === '>') {
                // Loose > in text, escape it
                result += '&gt;';
            } else {
                result += char;
            }
        }
        else if (state === STATE_TAG_OPEN) {
            // We just saw <. We expect a tag name.
            // Actually we can merge TAG_OPEN and TAG_NAME for simplicity in this loose parser
            // But let's keep it.
            result += char;
            if (/\s/.test(char)) {
                // < foo ... ? weird but ok
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
                state = STATE_ATTR_NAME;
                result += char;
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
                state = STATE_ATTR_NAME;
                result += char;
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
            if (xml.startsWith('-->', i - 2)) { // i is currently at >, i-1 is -, i-2 is -
                // Wait, we are processing char by char.
                // If we are at >, check if prev two were --
                if (char === '>' && result.endsWith('-->')) {
                    state = STATE_TEXT;
                }
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


// Tests
const tests = [
    {
        name: "Basic XML",
        input: '<root><child id="1">Hello</child></root>',
        expected: '<root><child id="1">Hello</child></root>'
    },
    {
        name: "Unescaped < in attribute",
        input: '<mxGraphModel><root><mxCell value="x < y" /></root></mxGraphModel>',
        expected: '<mxGraphModel><root><mxCell value="x &lt; y" /></root></mxGraphModel>'
    },
    {
        name: "Unescaped > in attribute",
        input: '<mxCell value="x > y" />',
        expected: '<mxCell value="x &gt; y" />'
    },
    {
        name: "Unescaped < in text",
        input: '<text>x < y</text>',
        expected: '<text>x &lt; y</text>'
    },
    {
        name: "Unescaped > in text",
        input: '<text>x > y</text>',
        expected: '<text>x &gt; y</text>'
    },
    {
        name: "Mixed valid tags and math",
        input: '<div style="font-size:12px">if x < 10 then y > 20</div>',
        expected: '<div style="font-size:12px">if x &lt; 10 then y &gt; 20</div>'
    },
    {
        name: "Complex Draw.io example",
        input: '<mxCell value="Math: 0 < x < 10" style="text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;" vertex="1" parent="1">',
        expected: '<mxCell value="Math: 0 &lt; x &lt; 10" style="text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;strokeColor=none;fillColor=none;" vertex="1" parent="1">'
    }
];

let passed = 0;
tests.forEach(t => {
    const output = sanitizeXml(t.input);
    if (output === t.expected) {
        console.log(`PASS: ${t.name}`);
        passed++;
    } else {
        console.error(`FAIL: ${t.name}`);
        console.error(`  Input:    ${t.input}`);
        console.error(`  Expected: ${t.expected}`);
        console.error(`  Actual:   ${output}`);
    }
});

if (passed === tests.length) {
    console.log(`\nAll ${passed} tests passed!`);
} else {
    console.log(`\n${passed}/${tests.length} tests passed.`);
    process.exit(1);
}
