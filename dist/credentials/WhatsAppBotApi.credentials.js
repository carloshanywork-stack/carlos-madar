"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppBotApi = void 0;
class WhatsAppBotApi {
    name = 'whatsAppBotApi';
    displayName = 'WhatsApp Bot API';
    documentationUrl = 'whatsapp';
    properties = [
        {
            displayName: 'Access Token',
            name: 'accessToken',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            required: true,
            description: 'System User access token from the WhatsApp > API Setup page of the Meta app. The token shown there by default is temporary and expires in 24 hours. Use a permanent System User access token instead.',
        },
        {
            displayName: 'Phone Number ID',
            name: 'phoneNumberId',
            type: 'string',
            default: '',
            required: true,
            description: 'The bot phone number ID, from the WhatsApp > API Setup page of the Meta app',
        },
        {
            displayName: 'WhatsApp Business Account ID',
            name: 'businessAccountId',
            type: 'string',
            default: '',
            required: true,
            description: 'The WABA ID that owns the phone number, from the same API Setup page',
        },
        {
            displayName: 'App Secret',
            name: 'appSecret',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            required: true,
            description: 'From App Settings > Basic in the Meta app. Used to verify inbound webhook signatures.',
        },
    ];
    authenticate = {
        type: 'generic',
        properties: {
            headers: {
                Authorization: '=Bearer {{$credentials.accessToken}}',
            },
        },
    };
    test = {
        request: {
            baseURL: 'https://graph.facebook.com/v21.0',
            url: '=/{{$credentials.phoneNumberId}}',
            ignoreHttpStatusErrors: true,
        },
        rules: [
            {
                type: 'responseSuccessBody',
                properties: {
                    key: 'error.type',
                    value: 'OAuthException',
                    message: 'Invalid access token',
                },
            },
        ],
    };
}
exports.WhatsAppBotApi = WhatsAppBotApi;
//# sourceMappingURL=WhatsAppBotApi.credentials.js.map