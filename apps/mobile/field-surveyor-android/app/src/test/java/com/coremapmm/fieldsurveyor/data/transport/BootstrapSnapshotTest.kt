package com.coremapmm.fieldsurveyor.data.transport

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BootstrapSnapshotTest {
    private val routeId = "11111111-1111-4111-8111-111111111111"
    private val variantD0 = "22222222-2222-4222-8222-222222222222"
    private val variantD1 = "22222222-2222-4222-8222-222222222223"
    private val stopA = "33333333-3333-4333-8333-333333333333"
    private val stopB = "33333333-3333-4333-8333-333333333334"

    private fun datasetJson(): String {
        return """
            {
              "snapshotRevision": "v1-test",
              "unchanged": false,
              "routes": [
                {"publicId":"$routeId","routeCode":"YBS-13","nameMy":null,"nameEn":"13"}
              ],
              "variants": [
                {"publicId":"$variantD0","routePublicId":"$routeId","variantCode":"D0","directionId":0,"originName":"A","destinationName":"B"},
                {"publicId":"$variantD1","routePublicId":"$routeId","variantCode":"D1","directionId":1,"originName":"B","destinationName":"A"}
              ],
              "stops": [
                {"publicId":"$stopA","stopCode":"S1","nameMy":null,"nameEn":"First","lat":16.8,"lng":96.15},
                {"publicId":"$stopB","stopCode":"S2","nameMy":null,"nameEn":"Second","lat":16.81,"lng":96.16}
              ],
              "routeStops": [
                {"variantPublicId":"$variantD0","stopPublicId":"$stopB","stopSequence":2},
                {"variantPublicId":"$variantD0","stopPublicId":"$stopA","stopSequence":1}
              ],
              "routePaths": [
                {"variantPublicId":"$variantD0","geometry":{"type":"LineString","coordinates":[[96.15,16.78],[96.16,16.79]]}}
              ]
            }
        """.trimIndent()
    }

    @Test
    fun matchingRevisionIsUnchanged() {
        val payload = BootstrapJson.parseResponse("""{"snapshotRevision":"v1-test","unchanged":true}""")
        assertTrue(payload is BootstrapPayload.Unchanged)
        assertEquals("v1-test", (payload as BootstrapPayload.Unchanged).snapshotRevision)
    }

    @Test
    fun validatesD0D1AndKeepsPath() {
        val payload = BootstrapJson.parseResponse(datasetJson()) as BootstrapPayload.Dataset
        val snapshot = SnapshotValidator.validate(BootstrapJson.parseDataset(payload.raw))
        assertEquals("v1-test", snapshot.snapshotRevision)
        assertEquals(listOf("D0", "D1"), snapshot.variants.map { it.variantCode })
        assertEquals(0, snapshot.variants.first { it.variantCode == "D0" }.directionId)
        assertEquals(1, snapshot.variants.first { it.variantCode == "D1" }.directionId)
        assertTrue(RoutePathGeometry.hasLineString(snapshot.paths.first().geometryJson))
    }

    @Test
    fun stopSequenceIsOrderedWhenSorted() {
        val payload = BootstrapJson.parseResponse(datasetJson()) as BootstrapPayload.Dataset
        val snapshot = SnapshotValidator.validate(BootstrapJson.parseDataset(payload.raw))
        val ordered = snapshot.routeStops
            .filter { it.variantPublicId == variantD0 }
            .sortedBy { it.stopSequence }
        assertEquals(listOf(1, 2), ordered.map { it.stopSequence })
        assertEquals(listOf(stopA, stopB), ordered.map { it.stopPublicId })
    }

    @Test
    fun rejectsMismatchedDirectionLabel() {
        val bad = JSONObject(datasetJson())
        bad.getJSONArray("variants").getJSONObject(0).put("variantCode", "D1")
        try {
            SnapshotValidator.validate(BootstrapJson.parseDataset(bad))
            throw AssertionError("expected invalid D0/D1")
        } catch (error: SnapshotParseException) {
            assertTrue(error.message!!.contains("D0/D1"))
        }
    }

    @Test
    fun failedValidateDoesNotProduceRevision() {
        val incomplete = """{"snapshotRevision":"v1-new","unchanged":false,"routes":[]}"""
        val payload = BootstrapJson.parseResponse(incomplete) as BootstrapPayload.Dataset
        try {
            SnapshotValidator.validate(BootstrapJson.parseDataset(payload.raw))
            throw AssertionError("expected missing arrays")
        } catch (error: SnapshotParseException) {
            assertFalse(error.message.isNullOrBlank())
        }
    }
}
