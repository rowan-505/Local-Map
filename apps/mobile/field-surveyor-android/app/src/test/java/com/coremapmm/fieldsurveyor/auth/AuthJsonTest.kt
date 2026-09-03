package com.coremapmm.fieldsurveyor.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthJsonTest {
    @Test
    fun parsesLoginResponse() {
        val body = """
            {
              "accessToken": "a.jwt",
              "refreshToken": "rotating",
              "expiresIn": "15m",
              "user": {
                "id": "1",
                "public_id": "11111111-1111-1111-1111-111111111111",
                "email": "s@example.com",
                "display_name": "Surveyor",
                "roles": ["surveyor"]
              }
            }
        """.trimIndent()

        val session = AuthJson.sessionFromBody(body)
        assertEquals("a.jwt", session.accessToken)
        assertEquals("rotating", session.refreshToken)
        assertEquals("15m", session.expiresIn)
        assertTrue(session.user.isFieldSurveyor)
        assertEquals("Surveyor", session.user.displayName)
    }

    @Test
    fun roundTripsUserJson() {
        val user = AuthUser(
            id = "1",
            publicId = "11111111-1111-1111-1111-111111111111",
            email = "s@example.com",
            displayName = "Surveyor",
            roles = listOf("surveyor"),
        )
        val restored = AuthJson.userFromJson(AuthJson.userToJson(user))
        assertEquals(user, restored)
    }

    @Test
    fun readsApiErrorMessage() {
        assertEquals("Invalid email or password", AuthJson.errorMessage("""{"message":"Invalid email or password"}""", "x"))
    }
}
