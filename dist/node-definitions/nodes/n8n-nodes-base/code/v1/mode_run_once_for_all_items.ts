/**
 * Code Node - Version 1
 * Discriminator: mode=runOnceForAllItems
 */


/** Run this code only once, no matter how many input items there are */
export type CodeV1RunOnceForAllItemsParams = {
  mode: 'runOnceForAllItems';
/**
 * Language
 * @default javaScript
 */
    language?: unknown;
/**
 * JavaScript code to execute.&lt;br&gt;&lt;br&gt;Tip: You can use luxon vars like &lt;code&gt;$today&lt;/code&gt; for dates and &lt;code&gt;$jmespath&lt;/code&gt; for querying JSON structures. &lt;a href="https://docs.n8n.io/nodes/n8n-nodes-base.function"&gt;Learn more&lt;/a&gt;.
 * @builderHint The sandbox has NO network access: fetch(), axios, XMLHttpRequest and require of http modules are unavailable and fail at runtime. NEVER make HTTP requests here — use the HTTP Request node and process its output in this node instead.
 */
    jsCode?: string;
/**
 * Python code to execute. Runs in a sandbox with no network access, and imports only work if your instance allowlists them: read the input items from &lt;code&gt;_items&lt;/code&gt; (all-items mode) or &lt;code&gt;_item&lt;/code&gt; (per-item mode). &lt;a href="https://docs.n8n.io/code/builtin/"&gt;Learn more&lt;/a&gt;.
 * @builderHint Locked-down sandbox. Imports are off unless the deployment allowlists them, so assume none are available — even `import re` fails on a stock instance. Write import-free Python with builtins, or use javaScript when the task needs a library; never tell the user to change the allowlist. NO network — use an HTTP Request node and process its output here. The only globals are _items (runOnceForAllItems), _item (runOnceForEachItem) and print(); the other mode's accessor, _("Node Name"), _input, _json and $-prefixed helpers are all undefined.
 * @displayOptions.show { language: ["python", "pythonNative"] }
 */
    pythonCode?: string;
};

export type CodeV1RunOnceForAllItemsNode = {
  type: 'n8n-nodes-base.code';
  version: 1;
  config: NodeConfig<CodeV1RunOnceForAllItemsParams>;
};