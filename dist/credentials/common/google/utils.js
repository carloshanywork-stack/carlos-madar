"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGoogleServiceAccountCredentials = getGoogleServiceAccountCredentials;
const format_pem_block_1 = require("@n8n/utils/format-pem-block");
const n8n_workflow_1 = require("n8n-workflow");
function getGoogleServiceAccountCredentials(credentials) {
    const { email, privateKey } = credentials;
    if (typeof email !== 'string' ||
        !email.trim() ||
        typeof privateKey !== 'string' ||
        !privateKey.trim()) {
        throw new n8n_workflow_1.UserError('Enter a service account email and private key.');
    }
    return { client_email: email.trim(), private_key: (0, format_pem_block_1.formatPemBlock)(privateKey) };
}
//# sourceMappingURL=utils.js.map