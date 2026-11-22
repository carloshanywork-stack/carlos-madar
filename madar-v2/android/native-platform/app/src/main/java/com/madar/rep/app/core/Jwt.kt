package com.madar.rep.app.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Minimal JWT payload reader. The app does not verify the signature; it only
 * needs `exp` to refresh the local session before the server rejects it.
 */
object Jwt {
    fun expiryEpochSeconds(token: String): Long? = runCatching {
        val payload = token.split('.').getOrNull(1) ?: return null
        val decoded = String(decodeBase64Url(payload), Charsets.UTF_8)
        Json.parseToJsonElement(decoded).jsonObject["exp"]?.jsonPrimitive?.longOrNull
    }.getOrNull()

    fun payloadJson(token: String): String? = runCatching {
        val payload = token.split('.').getOrNull(1) ?: return null
        String(decodeBase64Url(payload), Charsets.UTF_8)
    }.getOrNull()

    fun claim(token: String, key: String): String? = runCatching {
        val payload = token.split('.').getOrNull(1) ?: return null
        val decoded = String(decodeBase64Url(payload), Charsets.UTF_8)
        Json.parseToJsonElement(decoded).jsonObject[key]?.jsonPrimitive?.content
    }.getOrNull()

    private fun decodeBase64Url(value: String): ByteArray {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val output = ArrayList<Byte>(value.length * 3 / 4 + 3)
        var buffer = 0
        var bits = 0
        for (character in value) {
            if (character == '=') break
            val index = alphabet.indexOf(character)
            if (index < 0) throw IllegalArgumentException("Invalid base64url character")
            buffer = (buffer shl 6) or index
            bits += 6
            if (bits >= 8) {
                bits -= 8
                output.add(((buffer shr bits) and 0xFF).toByte())
            }
        }
        return output.toByteArray()
    }
}
