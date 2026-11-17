import kotlinx.serialization.*
import kotlinx.serialization.json.*
import com.madar.rep.app.data.api.AttendanceActionRequest

fun main() {
    val req = AttendanceActionRequest(
        actionUuid = "test-uuid",
        action = "in",
        occurredAt = "2023-01-01T00:00:00Z",
        location = null,
        biometricVerified = true
    )
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
    val str = json.encodeToString(AttendanceActionRequest.serializer(), req)
    println(str)
}
