package nl.kindobv.peercalc;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import com.healthmarketscience.jackcess.*;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ConverterTest {
  private static final ObjectMapper JSON = new ObjectMapper();
  private ObjectNode project() throws Exception {
    return (ObjectNode) JSON.readTree("""
      {"version":"2.3.0","schedule":{"name":"Test","projectName":"Test","projectNumber":"123","author":"Alice","client":"Client","tarieven":{"A":60}},"items":[
        {"id":"chapter","parentId":null,"rowType":"chapter","sortOrder":0,"code":"21","description":"Concrete","total":260},
        {"id":"post","parentId":"chapter","rowType":"begrotingspost","sortOrder":1,"code":"21.1","description":"Foundation","total":260,"quantity":1},
        {"id":"line","parentId":"post","rowType":"regel","sortOrder":2,"code":"C25","description":"Concrete C25","unit":"m³","quantity":2,"normUnitPrice":100,"normQuantity":0.5,"laborPrice":30,"tariefGroep":"A","resourceType":"materiaal","total":260},
        {"id":"vat","parentId":null,"rowType":"staart_btw","sortOrder":3,"description":"Btw hoog:","staartPercentage":21,"total":54.6,"staartItemBreakdown":{"bedrag":260,"subtotaal":54.6,"totaal":314.6}}
      ]}
      """);
  }
  private Path output(JsonNode project) throws Exception { Path file = Files.createTempFile("converter-test-", ".calc"); Files.write(file, Converter.convert(project)); return file; }

  @Test void createsRealAccessDatabaseWithCorrectLaborAndHierarchy() throws Exception {
    Path file = output(project());
    try (Database db = DatabaseBuilder.open(file)) {
      assertEquals(4, db.getTable("data").getRowCount());
      Row line = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25"));
      assertNotNull(line); assertEquals(2d, ((Number)line.get("aantal")).doubleValue());
      assertEquals(130d, ((Number)line.get("kosteneh")).doubleValue());
      assertEquals(1, ((Number)line.get("groep")).intValue()); assertEquals(1, ((Number)line.get("paragraaf")).intValue());
      Row footer = CursorBuilder.findRow(db.getTable("data"), Map.of("rectype", 16));
      assertNotNull(footer); assertEquals(1, ((Number)footer.get("groep")).intValue()); assertEquals(9999, ((Number)footer.get("paragraaf")).intValue());
      assertEquals(0.21, ((Number)db.getTable("staart").iterator().next().get("percentage")).doubleValue(), 1e-9);
      assertEquals(314.6, ((Number)db.getTable("calculaties").iterator().next().get("totaalinclbtw")).doubleValue(), 1e-8);
      Row calculation = db.getTable("calculaties").iterator().next();
      assertEquals(60d, ((Number)calculation.get("totaalloon")).doubleValue());
      assertEquals(200d, ((Number)calculation.get("totaalmateriaal")).doubleValue());
      assertEquals(1d, ((Number)calculation.get("totaaluren")).doubleValue());
    } finally { Files.deleteIfExists(file); }
  }

  @Test void editsOriginalRowsWithoutLosingUnknownTablesOrColumns() throws Exception {
    ObjectNode project = project(); Path file = output(project);
    int rec;
    try (Database db = new DatabaseBuilder(file).setReadOnly(false).open()) {
      Table custom = new TableBuilder("peer_custom").addColumn(new ColumnBuilder("value", DataType.TEXT)).toTable(db);
      custom.addRow("preserve me");
      Table table = db.getTable("data"); Row row = CursorBuilder.findRow(table, Map.of("code", "C25"));
      rec = ((Number)row.get("recnr")).intValue(); row.put("artikelnr", "opaque-123"); row.put("postsoort", "X"); table.updateRow(row);
    }
    project.set("wpcalcSource", JSON.createObjectNode().put("encoding", "base64").put("data", Base64.getEncoder().encodeToString(Files.readAllBytes(file))));
    try (Database db = DatabaseBuilder.open(file)) {
      for (Row row : db.getTable("data")) {
        for (JsonNode item : project.path("items")) if (item.path("code").asText().equals(Objects.toString(row.get("code"), ""))) ((ObjectNode)item).put("wpcalcRowId", ((Number)row.get("recnr")).intValue());
      }
    }
    ((ObjectNode)project.path("items").get(2)).put("quantity", 3).put("total", 390);
    Path updated = output(project);
    try (Database db = DatabaseBuilder.open(updated)) {
      assertEquals("preserve me", db.getTable("peer_custom").iterator().next().get("value"));
      Row row = CursorBuilder.findRow(db.getTable("data"), Map.of("recnr", rec));
      assertEquals("opaque-123", row.get("artikelnr")); assertEquals(3d, ((Number)row.get("aantal")).doubleValue());
      assertEquals("X", row.get("postsoort"));
    } finally { Files.deleteIfExists(file); Files.deleteIfExists(updated); }
  }

  @Test void refusesNestedPostsInsteadOfSilentlyFlattening() throws Exception {
    ObjectNode project = project();
    ((ObjectNode)project.path("items").get(2)).put("rowType", "bewakingspost");
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(project));
  }

  @Test void refusesIncompatibleResourceNormRatherThanExportingWrongTotal() throws Exception {
    ObjectNode project = project();
    ((ObjectNode)project.path("items").get(2)).put("laborPrice", 0).put("total", 100);
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(project));
  }

  @Test void refusesVariantProjectsRatherThanAddingAlternativePrices() throws Exception {
    ObjectNode project = project();
    ((ObjectNode)project.path("schedule")).put("branchesEnabled", true);
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(project));
  }

  @Test void refusesCalculationSemanticsThatCannotSurviveAReimport() throws Exception {
    for (String field : List.of("staartBasis", "btwTarief", "staartDoelbedrag", "staartAfrondingStap", "normFactor", "normDivisor")) {
      ObjectNode project = project(); ObjectNode item = (ObjectNode)project.path("items").get(2);
      if (field.equals("staartBasis")) item.put(field, "kostprijs");
      else if (field.equals("btwTarief")) item.put(field, "laag");
      else item.put(field, 2);
      assertThrows(IllegalArgumentException.class, () -> Converter.convert(project), field);
    }
  }

  @Test void refusesLinkedAccessTablesInsteadOfReadingServerFiles() throws Exception {
    Path target = output(project());
    Path linked = Files.createTempFile("converter-linked-", ".calc");
    Files.delete(linked);
    try {
      try (Database db = DatabaseBuilder.create(Database.FileFormat.V2000, linked.toFile())) {
        for (String name : List.of("calculaties", "data", "tarieven", "staart")) db.createLinkedTable(name, target.toString(), name);
      }
      ObjectNode project = project();
      project.set("wpcalcSource", JSON.createObjectNode().put("encoding", "base64").put("data", Base64.getEncoder().encodeToString(Files.readAllBytes(linked))));
      Exception error = assertThrows(java.io.IOException.class, () -> Converter.convert(project));
      assertTrue(error.getMessage().contains("Linked Access databases are not allowed"));
    } finally { Files.deleteIfExists(target); Files.deleteIfExists(linked); }
  }

  @Test void preservesExplicitLaborAndSetsActualVatRate() throws Exception {
    ObjectNode project = project();
    ObjectNode row = (ObjectNode)project.path("items").get(2);
    row.putNull("tariefGroep").put("wpcalcRateGroup", "A").put("normQuantity", 0.25).put("laborPrice", 20).put("total", 240);
    ((ObjectNode)project.path("items").get(3)).put("staartPercentage", 19).put("total", 45.6);
    Path file = output(project);
    try (Database db = DatabaseBuilder.open(file)) {
      Row line = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25"));
      assertEquals(0.25, ((Number)line.get("norm")).doubleValue());
      assertEquals(80d, ((Number)line.get("tarief")).doubleValue());
      assertEquals(0.19, ((Number)db.getTable("calculaties").iterator().next().get("btwhoog")).doubleValue(), 1e-9);
    } finally { Files.deleteIfExists(file); }
  }

  @Test void rejectsCurrencyAndQuantityFormulaChangesAndInventedLaborHours() throws Exception {
    ObjectNode currency = project(); ((ObjectNode)currency.path("schedule")).put("currency", "USD");
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(currency));
    ObjectNode formula = project(); ((ObjectNode)formula.path("items").get(2)).put("wpcalcQuantityFormula", "2*3").put("wpcalcOriginalQuantity", 6);
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(formula));
    ObjectNode labor = project(); ((ObjectNode)labor.path("items").get(2)).putNull("normQuantity");
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(labor));
  }

  private void attachSource(ObjectNode project, Path file) throws Exception {
    ObjectNode source = JSON.createObjectNode().put("encoding", "base64").put("data", Base64.getEncoder().encodeToString(Files.readAllBytes(file)));
    ArrayNode ids = source.putArray("importedRowIds");
    try (Database db = DatabaseBuilder.open(file)) {
      for (Row row : db.getTable("data")) {
        if (((Number)row.get("rectype")).intValue() == 16) continue;
        for (JsonNode item : project.path("items")) {
          if (item.path("rowType").asText().startsWith("staart_")) continue;
          if (item.path("code").asText().equals(Objects.toString(row.get("code"), ""))) {
            int rec = ((Number)row.get("recnr")).intValue(); ((ObjectNode)item).put("wpcalcRowId", rec); ids.add(rec);
          }
        }
      }
    }
    project.set("wpcalcSource", source);
  }

  @Test void preservesSourceFooterColumnsAndRemapsChaptersOnReorderWithoutDuplicates() throws Exception {
    ObjectNode project = project();
    ((ArrayNode)project.path("items")).add(JSON.createObjectNode().put("id", "second").putNull("parentId").put("rowType", "chapter").put("sortOrder", 5).put("code", "22").put("description", "Second").put("total", 0));
    Path source = output(project);
    int firstFooter;
    try (Database db = new DatabaseBuilder(source).setReadOnly(false).open()) {
      Row footer = CursorBuilder.findRow(db.getTable("data"), Map.of("rectype", 16, "groep", 1));
      firstFooter = ((Number)footer.get("recnr")).intValue(); footer.put("artikelnr", "footer-extension"); db.getTable("data").updateRow(footer);
    }
    attachSource(project, source);
    ((ObjectNode)project.path("items").get(0)).put("sortOrder", 10);
    ((ObjectNode)project.path("items").get(4)).put("sortOrder", 0);
    Path changed = output(project);
    try (Database db = DatabaseBuilder.open(changed)) {
      int count = 0;
      for (Row row : db.getTable("data")) if (((Number)row.get("rectype")).intValue() == 16) count++;
      assertEquals(2, count);
      Row footer = CursorBuilder.findRow(db.getTable("data"), Map.of("recnr", firstFooter));
      assertEquals(2, ((Number)footer.get("groep")).intValue()); assertEquals("footer-extension", footer.get("artikelnr"));
      Row child = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25"));
      assertEquals(2, ((Number)child.get("groep")).intValue());
    } finally { Files.deleteIfExists(source); Files.deleteIfExists(changed); }
  }

  @Test void quantityOnlyEditsKeepSourceGroupingAndUnknownRowsButUnsafeStructureIsRejected() throws Exception {
    ObjectNode project = project(); Path source = output(project);
    try (Database db = new DatabaseBuilder(source).setReadOnly(false).open()) {
      Table data = db.getTable("data");
      for (Row row : data) { row.put("groep", 21); data.updateRow(row); }
      Map<String, Object> opaque = new HashMap<>(); opaque.put("recnr", 999); opaque.put("docnr", 1); opaque.put("groep", 21); opaque.put("rectype", 77); opaque.put("omschrijving", "opaque"); data.addRowFromMap(opaque);
    }
    attachSource(project, source);
    ((ObjectNode)project.path("items").get(2)).put("quantity", 3).put("total", 390);
    Path edited = output(project);
    try (Database db = DatabaseBuilder.open(edited)) {
      assertEquals(5, db.getTable("data").getRowCount());
      for (Row row : db.getTable("data")) assertEquals(21, ((Number)row.get("groep")).intValue());
    }
    ((ArrayNode)project.path("items")).add(JSON.createObjectNode().put("id", "new").putNull("parentId").put("rowType", "chapter").put("sortOrder", 5).put("code", "99").put("description", "New").put("total", 0));
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(project));
    Files.deleteIfExists(source); Files.deleteIfExists(edited);
  }

  @Test void deletingAChapterDeletesItsManagedRowsAndFooterButKeepsOtherChapters() throws Exception {
    ObjectNode project = project();
    ((ArrayNode)project.path("items")).add(JSON.createObjectNode().put("id", "second").putNull("parentId").put("rowType", "chapter").put("sortOrder", 5).put("code", "22").put("description", "Second").put("total", 0));
    Path source = output(project); attachSource(project, source);
    ArrayNode remaining = JSON.createArrayNode().add(project.path("items").get(4)); project.set("items", remaining);
    Path edited = output(project);
    try (Database db = DatabaseBuilder.open(edited)) {
      assertEquals(2, db.getTable("data").getRowCount());
      assertNotNull(CursorBuilder.findRow(db.getTable("data"), Map.of("rectype", 16, "groep", 2)));
      assertNull(CursorBuilder.findRow(db.getTable("data"), Map.of("rectype", 16, "groep", 1)));
    } finally { Files.deleteIfExists(source); Files.deleteIfExists(edited); }
  }

  @Test void keepsAnUncalculatedSourcePriceDormantUntilExplicitActivation() throws Exception {
    ObjectNode project = project(); Path source = output(project);
    try (Database db = new DatabaseBuilder(source).setReadOnly(false).open()) {
      Row line = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25"));
      line.put("kosteneh", null); line.put("norm", null); line.put("tarief", 0d); db.getTable("data").updateRow(line);
    }
    attachSource(project, source);
    ObjectNode item = (ObjectNode)project.path("items").get(2);
    item.put("wpcalcUncalculatedPrice", true).put("wpcalcOriginalPrice", 100).put("wpcalcOriginalQuantity", 2).put("normUnitPrice", 0).put("laborPrice", 0).putNull("normQuantity").putNull("tariefGroep").put("total", 0);
    Path dormant = output(project);
    try (Database db = DatabaseBuilder.open(dormant)) {
      Row line = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25")); assertNull(line.get("kosteneh")); assertEquals(100d, ((Number)line.get("prijs")).doubleValue()); assertEquals(2d, ((Number)line.get("aantal")).doubleValue());
    }
    item.put("quantity", 3); assertThrows(IllegalArgumentException.class, () -> Converter.convert(project)); item.put("quantity", 2);
    item.put("wpcalcUncalculatedPrice", false).put("normUnitPrice", 100).put("total", 200);
    Path activated = output(project);
    try (Database db = DatabaseBuilder.open(activated)) {
      Row line = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25")); assertEquals(100d, ((Number)line.get("kosteneh")).doubleValue());
    } finally { Files.deleteIfExists(source); Files.deleteIfExists(dormant); Files.deleteIfExists(activated); }
  }

  @Test void updatesGlobalRatesAndHourCachesWithoutMaterializingInheritedRowTariffs() throws Exception {
    ObjectNode project = project(); Path source = output(project);
    try (Database db = new DatabaseBuilder(source).setReadOnly(false).open()) {
      Row rate = db.getTable("tarieven").iterator().next(); rate.put("docnr", -1); db.getTable("tarieven").updateRow(rate);
      Row hour = CursorBuilder.findRow(db.getTable("uren"), Map.of("tariefgroep", "A")); hour.put("memotekst", "preserved hour note"); db.getTable("uren").updateRow(hour);
    }
    attachSource(project, source);
    ((ObjectNode)project.path("schedule").path("tarieven")).put("A", 70);
    ((ObjectNode)project.path("items").get(2)).put("laborPrice", 35).put("total", 270);
    Path edited = output(project);
    try (Database db = DatabaseBuilder.open(edited)) {
      assertEquals(1, db.getTable("tarieven").getRowCount()); Row rate = db.getTable("tarieven").iterator().next(); assertEquals(-1, ((Number)rate.get("docnr")).intValue()); assertEquals(70d, ((Number)rate.get("tarief")).doubleValue());
      Row line = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25")); assertEquals(0d, ((Number)line.get("tarief")).doubleValue()); assertEquals(135d, ((Number)line.get("kosteneh")).doubleValue());
      Row hour = CursorBuilder.findRow(db.getTable("uren"), Map.of("tariefgroep", "A")); assertEquals(1d, ((Number)hour.get("aantal")).doubleValue()); assertEquals(70d, ((Number)hour.get("bedrag")).doubleValue()); assertEquals("preserved hour note", hour.get("memotekst"));
    } finally { Files.deleteIfExists(source); Files.deleteIfExists(edited); }
  }

  @Test void refusesComponentDerivedPriceEditsAndDeletingLinkedMeasurements() throws Exception {
    ObjectNode project = project(); Path source = output(project);
    try (Database db = new DatabaseBuilder(source).setReadOnly(false).open()) {
      new ColumnBuilder("bruto", DataType.DOUBLE).addToTable(db.getTable("data"));
      new ColumnBuilder("usref", DataType.LONG).addToTable(db.getTable("data"));
      Row line = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25")); line.put("bruto", 100d); line.put("usref", 123); db.getTable("data").updateRow(line);
    }
    attachSource(project, source);
    ((ObjectNode)project.path("items").get(2)).put("normUnitPrice", 105).put("total", 270);
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(project));
    ((ObjectNode)project.path("items").get(2)).put("normUnitPrice", 100).put("total", 260);
    ((ArrayNode)project.path("items")).remove(2);
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(project)); Files.deleteIfExists(source);
  }

  @Test void omitsZeroRoundingAndRejectsUnverifiedNonzeroRoundingEncoding() throws Exception {
    ObjectNode project = project();
    ObjectNode rounding = JSON.createObjectNode().put("id", "rounding").putNull("parentId").put("rowType", "staart_afronding").put("description", "Afronding").put("total", 0);
    ((ArrayNode)project.path("items")).add(rounding);
    Path zero = output(project);
    try (Database db = DatabaseBuilder.open(zero)) {
      assertNull(CursorBuilder.findRow(db.getTable("staart"), Map.of("code", "peercalc:staart_afronding")));
    } finally { Files.deleteIfExists(zero); }
    rounding.put("total", 5).put("staartVastBedrag", 5);
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(project));
  }

  @Test void preservesNullAndNormalizedSourceFieldsOnNoopExport() throws Exception {
    ObjectNode project = project(); Path source = output(project);
    try (Database db = new DatabaseBuilder(source).setReadOnly(false).open()) {
      Row row = CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25"));
      for (String field : List.of("eenheid", "code", "prijs", "norm", "tarief", "kosteneh", "onderaanneming", "materieel", "stelpost", "vastbedrag")) row.put(field, null);
      db.getTable("data").updateRow(row);
    }
    ObjectNode row = (ObjectNode)project.path("items").get(2);
    row.put("code", "").put("unit", "st").put("wpcalcNativeUnit", "st").putNull("normUnitPrice").putNull("normQuantity").put("laborPrice", 0).put("total", 0);
    attachSource(project, source); Path exported = output(project);
    Map<String, Object> expected;
    try (Database db = DatabaseBuilder.open(source)) { expected = new HashMap<>(CursorBuilder.findRow(db.getTable("data"), Map.of("recnr", row.path("wpcalcRowId").asInt()))); }
    try (Database db = DatabaseBuilder.open(exported)) {
      Row result = CursorBuilder.findRow(db.getTable("data"), Map.of("recnr", row.path("wpcalcRowId").asInt()));
      for (String field : List.of("eenheid", "code", "prijs", "norm", "tarief", "kosteneh", "onderaanneming", "materieel", "stelpost", "vastbedrag")) assertEquals(expected.get(field), result.get(field), field);
      assertEquals(2d, ((Number)result.get("aantal")).doubleValue());
    } finally { Files.deleteIfExists(source); Files.deleteIfExists(exported); }
  }

  @Test void updatesRichSchemaNotesAndRejectsDroppingNotesInOlderSchemas() throws Exception {
    ObjectNode project = project();
    ((ObjectNode)project.path("items").get(2)).put("notes", "Source note");
    assertThrows(IllegalArgumentException.class, () -> Converter.convert(project));
    ((ObjectNode)project.path("items").get(2)).put("notes", ""); Path source = output(project);
    try (Database db = new DatabaseBuilder(source).setReadOnly(false).open()) { new ColumnBuilder("memotekst", DataType.MEMO).addToTable(db.getTable("data")); }
    attachSource(project, source); ((ObjectNode)project.path("items").get(2)).put("notes", "Edited note"); Path changed = output(project);
    try (Database db = DatabaseBuilder.open(changed)) { assertEquals("Edited note", CursorBuilder.findRow(db.getTable("data"), Map.of("code", "C25")).get("memotekst")); }
    finally { Files.deleteIfExists(source); Files.deleteIfExists(changed); }
  }

  @Test void preservesOriginalTailCodesWhenDescriptionAndPercentageChange() throws Exception {
    ObjectNode project = project(); Path source = output(project); int id;
    try (Database db = new DatabaseBuilder(source).setReadOnly(false).open()) {
      Row vat = CursorBuilder.findRow(db.getTable("staart"), Map.of("itemtype", 256)); id = ((Number)vat.get("recnr")).intValue(); vat.put("code", "custom-tax-code"); db.getTable("staart").updateRow(vat);
    }
    attachSource(project, source);
    ((ObjectNode)project.path("items").get(3)).put("wpcalcStaartRowId", id).put("description", "Edited tax label").put("staartPercentage", 19).put("total", 49.4);
    Path edited = output(project);
    try (Database db = DatabaseBuilder.open(edited)) { Row vat = CursorBuilder.findRow(db.getTable("staart"), Map.of("recnr", id)); assertEquals("custom-tax-code", vat.get("code")); assertEquals("Edited tax label", vat.get("omschrijving")); assertEquals(0.19, ((Number)vat.get("percentage")).doubleValue(), 1e-9); }
    finally { Files.deleteIfExists(source); Files.deleteIfExists(edited); }
  }
}
