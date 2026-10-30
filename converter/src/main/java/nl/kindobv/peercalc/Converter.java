package nl.kindobv.peercalc;

import com.fasterxml.jackson.databind.JsonNode;
import com.healthmarketscience.jackcess.*;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;

/** WPCalc column mappings derived from Open Calc Studio's LGPL-3.0-only wpcalc_export.rs. */
public final class Converter {
  private record Position(int group, int paragraph, int sequence, int type, int depth) {}

  public static byte[] convert(JsonNode project) throws IOException {
    if (!project.path("schedule").isObject() || !project.path("items").isArray()) throw new IllegalArgumentException("Native schedule and items are required");
    if (!project.path("schedule").path("currency").asText("EUR").equals("EUR")) throw new IllegalArgumentException("WPCalc export currently supports EUR only; export the native document instead");
    if (project.path("schedule").path("branchesEnabled").asBoolean(false) || !project.path("schedule").path("branches").isEmpty()) throw new IllegalArgumentException("Variant projects require an explicit active-view export before conversion to WPCalc");
    List<JsonNode> items = new ArrayList<>();
    project.path("items").forEach(items::add);
    if (items.size() > 20_000) throw new IllegalArgumentException("At most 20,000 rows are supported");
    for (JsonNode item : items) {
      if (item.path("rowType").asText().equals("staart_afronding") && (numeric(item, "total") != 0 || numeric(item, "staartVastBedrag") != 0)) throw new IllegalArgumentException("WPCalc fixed-rounding encoding is not verified; export the native document instead");
      if (!item.path("wpcalcQuantityFormula").asText("").isBlank() && numeric(item, "quantity") != numeric(item, "wpcalcOriginalQuantity")) throw new IllegalArgumentException("Quantity is controlled by an original WPCalc formula; changing it cannot be exported safely");
      if (item.path("staartBasis").asText().equals("kostprijs")) throw new IllegalArgumentException("WPCalc export cannot yet preserve direct-cost surcharge bases; export the native document instead");
      if (!item.path("btwTarief").isNull() && !item.path("btwTarief").isMissingNode()) throw new IllegalArgumentException("WPCalc export cannot yet preserve per-row VAT classifications; export the native document instead");
      if (!item.path("staartDoelbedrag").isNull() && !item.path("staartDoelbedrag").isMissingNode()) throw new IllegalArgumentException("WPCalc export cannot yet preserve target-total rounding; export the native document instead");
      if (numeric(item, "staartAfrondingStap") > 0) throw new IllegalArgumentException("WPCalc export cannot yet preserve automatic rounding steps; export the native document instead");
      for (String field : List.of("normFactor", "normDivisor")) {
        if (!item.path(field).isMissingNode() && !item.path(field).isNull() && numeric(item, field) != 1) throw new IllegalArgumentException("WPCalc export cannot yet preserve norm factors/divisors; export the native document instead");
      }
    }
    Path file = Files.createTempFile("peercalc-", ".calc");
    try {
      JsonNode source = project.path("wpcalcSource");
      if (source.isObject()) {
        if (!source.path("encoding").asText().equals("base64")) throw new IllegalArgumentException("Unsupported source encoding");
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(source.path("data").asText()); }
        catch (IllegalArgumentException error) { throw new IllegalArgumentException("Invalid original WPCalc database"); }
        if (bytes.length > 12 * 1024 * 1024) throw new IllegalArgumentException("Original database exceeds 12 MiB");
        Files.write(file, bytes);
      } else {
        try (var template = Converter.class.getResourceAsStream("/wpcalc-template.calc")) {
          if (template == null) throw new IOException("Missing WPCalc template");
          Files.copy(template, file, StandardCopyOption.REPLACE_EXISTING);
        }
      }
      try (Database db = new DatabaseBuilder(file).setReadOnly(false).setAutoSync(false).open()) {
        db.setLinkResolver((linker, name) -> { throw new IOException("Linked Access databases are not allowed"); });
        db.setEvaluateExpressions(false);
        db.setAllowAutoNumberInsert(true);
        Table calculations = db.getTable("calculaties");
        Table data = db.getTable("data");
        Table rates = db.getTable("tarieven");
        Table tail = db.getTable("staart");
        if (calculations == null || data == null || rates == null || tail == null) throw new IllegalArgumentException("Not a supported WPCalc database");
        List<Row> calcRows = rows(calculations);
        if (calcRows.size() > 1) throw new IllegalArgumentException("Multi-document WPCalc files cannot be exported without ambiguity");
        int doc = calcRows.isEmpty() ? 1 : number(calcRows.get(0).get("docnr"));
        Map<String, Double> originalRates = new HashMap<>();
        for (Row rate : rows(rates)) if (number(rate.get("docnr")) == -1 && rate.get("tarief") instanceof Number value) originalRates.put(Objects.toString(rate.get("tariefgroep"), "A"), value.doubleValue());
        for (Row rate : rows(rates)) if (number(rate.get("docnr")) == doc && rate.get("tarief") instanceof Number value) originalRates.put(Objects.toString(rate.get("tariefgroep"), "A"), value.doubleValue());
        Map<Integer, Row> existing = new HashMap<>();
        int nextRec = 1;
        for (Row row : rows(data)) {
          int rec = number(row.get("recnr")); nextRec = Math.max(nextRec, rec + 1);
          if (number(row.get("docnr")) == doc) existing.put(rec, row);
        }
        Map<String, Position> positions = positions(items);
        retainSourcePositions(positions, existing, items);
        Set<Integer> managed = new HashSet<>();
        source.path("importedRowIds").forEach(id -> managed.add(id.asInt()));
        Set<Integer> incomingIds = new HashSet<>();
        items.forEach(item -> { if (!item.path("rowType").asText().startsWith("staart_")) incomingIds.add(item.path("wpcalcRowId").asInt(-1)); });
        for (int id : managed) {
          Row old = existing.get(id);
          if (old == null || incomingIds.contains(id)) continue;
          for (String reference : List.of("usref", "objref", "celref", "recref")) if (old.get(reference) instanceof Number value && value.doubleValue() != 0) throw new IllegalArgumentException("This source row has linked measurements or records; deletion requires a verified cascading mapping");
        }
        nextRec = rewriteStructure(data, existing, positions, items, managed, doc, nextRec);
        Set<Integer> retained = new HashSet<>();
        boolean notesSupported = data.getColumns().stream().anyMatch(column -> column.getName().equalsIgnoreCase("memotekst"));
        for (JsonNode item : items) {
          if (item.path("rowType").asText().startsWith("staart_")) continue;
          Position pos = positions.get(item.path("id").asText());
          int originalId = item.path("wpcalcRowId").asInt(-1);
          Row old = existing.get(originalId);
          if (old != null && !retained.add(originalId)) throw new IllegalArgumentException("Duplicate original WPCalc row identifier");
          int rec = old == null ? nextRec++ : originalId;
          Map<String, Object> values = dataValues(item, project.path("schedule"), pos, doc, rec, old, originalRates);
          String notes = item.path("notes").asText("");
          if (!notesSupported && !notes.isEmpty()) throw new IllegalArgumentException("This WPCalc schema has no row-note column; export the native document to preserve notes");
          if (notesSupported) values.put("memotekst", old != null && old.get("memotekst") == null && notes.isEmpty() ? null : notes);
          if (old == null) { values.put("postsoort", "N"); insert(data, values); } else update(data, old, values);
        }
        // Source row management is explicit: skipped legacy rows must not be mistaken for user deletions.
        for (Row row : existing.values()) if (managed.contains(number(row.get("recnr"))) && !retained.contains(number(row.get("recnr")))) data.deleteRow(row);
        JsonNode schedule = project.path("schedule");
        double direct = 0, incl = 0, vat = 0;
        for (JsonNode item : items) {
          if (item.path("parentId").isNull() || item.path("parentId").isMissingNode()) {
            double amount = numeric(item, "total"); incl += amount;
            if (!item.path("rowType").asText().startsWith("staart_")) direct += amount;
            if (item.path("rowType").asText().startsWith("staart_btw")) vat += amount;
          }
        }
        Map<String, Object> calcValues = new HashMap<>();
        calcValues.put("docnr", doc);
        calcValues.put("calculator", schedule.path("author").asText(""));
        calcValues.put("calculatietitel", schedule.path("projectName").asText(schedule.path("name").asText("")));
        calcValues.put("offertenr", schedule.path("projectNumber").asText(""));
        calcValues.put("naam", schedule.path("client").asText(""));
        calcValues.put("kostprijs", direct); calcValues.put("totaalexclbtw", incl - vat); calcValues.put("totaalinclbtw", incl); calcValues.put("btw", vat);
        calcValues.putAll(resourceTotals(items));
        calcValues.put("btwhoog", vatRate(items, "staart_btw", 0.21)); calcValues.put("btwlaag", vatRate(items, "staart_btw_laag", 0.09));
        calcValues.put("gewijzigd", new Date());
        if (calcRows.isEmpty()) {
          calcValues.put("projectnr", 0); calcValues.put("btwcode", 2); calcValues.put("btwmethode", 0);
          calcValues.put("aangemaakt", new Date()); calcValues.put("calculatiedatum", new Date());
          calcValues.put("layoutfile", "< Standaard >"); calcValues.put("maxhfdst", 99);
          calcValues.put("loonkolommen", true); calcValues.put("oakolom", true); calcValues.put("koers", 1d);
          for (String name : List.of("wfa", "wfm", "wfmta", "wfmte", "wfoda", "wfstp", "wfarb")) calcValues.put(name, 1d);
          insert(calculations, calcValues);
        } else update(calculations, calcRows.get(0), calcValues);
        writeRates(rates, schedule, doc);
        writeTail(tail, items, doc, source);
        writeHours(db.getTable("uren"), items, doc);
        db.flush();
      }
      return Files.readAllBytes(file);
    } finally { Files.deleteIfExists(file); }
  }

  private static int rewriteStructure(Table table, Map<Integer, Row> original, Map<String, Position> positions, List<JsonNode> items, Set<Integer> managed, int doc, int nextRec) throws IOException {
    Map<Integer, Position> matched = new HashMap<>();
    Map<Integer, Integer> groups = new HashMap<>();
    Map<String, Position> paragraphs = new HashMap<>();
    Set<Integer> sourceChapterGroups = new HashSet<>();
    Set<String> sourcePostKeys = new HashSet<>();
    boolean changed = false;
    for (Row row : original.values()) {
      if (number(row.get("rectype")) == 8) sourceChapterGroups.add(number(row.get("groep")));
      if (number(row.get("rectype")) == 4) sourcePostKeys.add(number(row.get("groep")) + ":" + number(row.get("paragraaf")));
    }
    for (JsonNode item : items) {
      if (item.path("rowType").asText().startsWith("staart_")) continue;
      Position position = positions.get(item.path("id").asText());
      Row old = original.get(item.path("wpcalcRowId").asInt(-1));
      if (old == null) { changed = true; continue; }
      int rec = number(old.get("recnr"));
      if (matched.put(rec, position) != null) throw new IllegalArgumentException("Duplicate original WPCalc row identifier");
      int oldGroup = number(old.get("groep")), oldParagraph = number(old.get("paragraaf"));
      if (number(old.get("rectype")) == 8 && position.type == 8) {
        Integer previous = groups.put(oldGroup, position.group);
        if (previous != null && previous != position.group) throw new IllegalArgumentException("Ambiguous original WPCalc chapter grouping");
      }
      if (number(old.get("rectype")) == 4 && position.type == 4) paragraphs.put(oldGroup + ":" + oldParagraph, position);
      changed |= oldGroup != position.group || oldParagraph != position.paragraph || number(old.get("volgnr")) != position.sequence || number(old.get("rectype")) != position.type;
    }
    for (int id : managed) if (original.containsKey(id) && !matched.containsKey(id)) changed = true;

    Set<Integer> footerGroups = new HashSet<>();
    for (Row row : original.values()) {
      int rec = number(row.get("recnr")), type = number(row.get("rectype"));
      if (matched.containsKey(rec) || (managed.contains(rec) && type != 16)) continue;
      int oldGroup = number(row.get("groep")), paragraph = number(row.get("paragraaf"));
      Integer group = groups.containsKey(oldGroup) ? groups.get(oldGroup) : oldGroup == 0 && !sourceChapterGroups.contains(0) ? 0 : null;
      if (type == 16) {
        if (group == null && sourceChapterGroups.contains(oldGroup)) {
          boolean deleted = original.values().stream().anyMatch(chapter -> number(chapter.get("rectype")) == 8 && number(chapter.get("groep")) == oldGroup && managed.contains(number(chapter.get("recnr"))));
          if (deleted) { table.deleteRow(row); continue; }
        }
        if (group == null) throw new IllegalArgumentException("An original WPCalc chapter footer has no identifiable chapter; structural export needs a verified mapping");
        if (!footerGroups.add(group)) throw new IllegalArgumentException("Multiple original WPCalc chapter footers cannot be merged safely");
        update(table, row, Map.of("groep", group));
        continue;
      }
      boolean blankText = type == 5 && Objects.toString(row.get("omschrijving"), "").isBlank();
      if (changed && !blankText) throw new IllegalArgumentException("Structural edits cannot preserve unmapped WPCalc records safely; keep the original structure or export the native document");
      if (!changed) continue;
      if (group == null) throw new IllegalArgumentException("A skipped WPCalc record belongs to a removed chapter; export the native document to preserve it");
      Map<String, Object> values = new HashMap<>(); values.put("groep", group);
      String key = oldGroup + ":" + paragraph;
      Position post = paragraphs.get(key);
      if (paragraph > 0 && paragraph < 9999 && sourcePostKeys.contains(key)) {
        if (post == null) throw new IllegalArgumentException("A skipped WPCalc record belongs to a removed post; export the native document to preserve it");
        values.put("groep", post.group); values.put("paragraaf", post.paragraph);
      }
      update(table, row, values);
    }
    for (Position position : positions.values()) {
      if (position.type != 8 || footerGroups.contains(position.group)) continue;
      Map<String, Object> footer = new HashMap<>();
      footer.put("recnr", nextRec++); footer.put("docnr", doc); footer.put("groep", position.group); footer.put("paragraaf", 9999); footer.put("volgnr", 0); footer.put("tabs", 0); footer.put("rectype", 16);
      for (String field : List.of("omschrijving", "code", "eenheid", "tariefgroep")) footer.put(field, "");
      for (String field : List.of("aantal", "prijs", "kosteneh", "norm", "tarief")) footer.put(field, 0d);
      for (String field : List.of("onderaanneming", "materieel", "stelpost", "vastbedrag")) footer.put(field, false);
      footer.put("postsoort", "N"); insert(table, footer); footerGroups.add(position.group);
    }
    return nextRec;
  }

  private static void retainSourcePositions(Map<String, Position> positions, Map<Integer, Row> original, List<JsonNode> items) {
    Map<Integer, Integer> chapters = new HashMap<>();
    Map<String, Integer> posts = new HashMap<>();
    Map<String, JsonNode> current = new HashMap<>();
    Map<String, List<JsonNode>> siblings = new HashMap<>();
    for (Row row : original.values()) {
      if (number(row.get("rectype")) == 8) chapters.put(number(row.get("groep")), number(row.get("recnr")));
      if (number(row.get("rectype")) == 4) posts.put(number(row.get("groep")) + ":" + number(row.get("paragraaf")), number(row.get("recnr")));
    }
    for (JsonNode item : items) current.put(item.path("id").asText(), item);
    for (JsonNode item : items) {
      if (item.path("rowType").asText().startsWith("staart_")) continue;
      Row old = original.get(item.path("wpcalcRowId").asInt(-1));
      if (old == null) return;
      Position next = positions.get(item.path("id").asText());
      int type = number(old.get("rectype")), group = number(old.get("groep")), paragraph = number(old.get("paragraaf"));
      boolean oldText = type == 0 && next.type == 5 && number(old.get("aantal")) == 0 && number(old.get("prijs")) == 0 && number(old.get("kosteneh")) == 0;
      if (type != next.type && !oldText) return;
      Integer oldParent = type == 8 ? null : type != 4 && paragraph > 0 && paragraph < 9999 && posts.containsKey(group + ":" + paragraph) ? posts.get(group + ":" + paragraph) : chapters.get(group);
      JsonNode parent = current.get(item.path("parentId").asText(""));
      Integer currentParent = parent == null ? null : parent.path("wpcalcRowId").asInt(-1);
      if (!Objects.equals(oldParent, currentParent)) return;
      siblings.computeIfAbsent(item.path("parentId").asText(""), ignored -> new ArrayList<>()).add(item);
    }
    Comparator<JsonNode> sourceOrder = Comparator.comparingInt((JsonNode item) -> number(original.get(item.path("wpcalcRowId").asInt()).get("groep")))
      .thenComparingInt(item -> number(original.get(item.path("wpcalcRowId").asInt()).get("paragraaf")))
      .thenComparingInt(item -> number(original.get(item.path("wpcalcRowId").asInt()).get("volgnr")))
      .thenComparingInt(item -> item.path("wpcalcRowId").asInt());
    for (List<JsonNode> list : siblings.values()) {
      list.sort(Comparator.comparingDouble(item -> numeric(item, "sortOrder")));
      for (int i = 1; i < list.size(); i++) if (sourceOrder.compare(list.get(i - 1), list.get(i)) > 0) return;
    }
    for (JsonNode item : items) {
      if (item.path("rowType").asText().startsWith("staart_")) continue;
      Row old = original.get(item.path("wpcalcRowId").asInt());
      Position next = positions.get(item.path("id").asText());
      positions.put(item.path("id").asText(), new Position(number(old.get("groep")), number(old.get("paragraaf")), number(old.get("volgnr")), number(old.get("rectype")), next.depth));
    }
  }

  private static Map<String, Position> positions(List<JsonNode> items) {
    Map<String, JsonNode> byId = new HashMap<>();
    Map<String, List<JsonNode>> children = new HashMap<>();
    for (JsonNode item : items) {
      String id = item.path("id").asText();
      if (id.isBlank() || byId.put(id, item) != null) throw new IllegalArgumentException("Unique row IDs are required");
      children.computeIfAbsent(item.path("parentId").asText(""), ignored -> new ArrayList<>()).add(item);
    }
    for (List<JsonNode> list : children.values()) list.sort(Comparator.comparingDouble(item -> numeric(item, "sortOrder")));
    Map<String, Position> result = new HashMap<>();
    int group = 0, rootParagraph = 0, rootSeq = 0;
    for (JsonNode root : children.getOrDefault("", List.of())) {
      String type = root.path("rowType").asText();
      if (type.startsWith("staart_")) continue;
      if (type.equals("chapter")) {
        group++;
        result.put(root.path("id").asText(), new Position(group, 0, 0, 8, 0));
        int paragraph = 0, seq = 0;
        for (JsonNode child : children.getOrDefault(root.path("id").asText(), List.of())) {
          String childType = child.path("rowType").asText();
          if (childType.equals("begrotingspost") || childType.equals("bewakingspost")) {
            paragraph++;
            addPost(child, children, result, group, paragraph, 1);
          } else {
            leaf(child, children, result, group, 0, ++seq, 1);
          }
        }
      } else if (type.equals("begrotingspost") || type.equals("bewakingspost")) {
        addPost(root, children, result, 0, ++rootParagraph, 0);
      } else leaf(root, children, result, 0, 0, ++rootSeq, 0);
    }
    for (JsonNode item : items) if (!item.path("rowType").asText().startsWith("staart_") && !result.containsKey(item.path("id").asText())) throw new IllegalArgumentException("WPCalc export supports chapters, one post level, and calculation/text rows; nested posts cannot be represented without losing hierarchy");
    return result;
  }

  private static void addPost(JsonNode post, Map<String, List<JsonNode>> children, Map<String, Position> result, int group, int paragraph, int depth) {
    var list = children.getOrDefault(post.path("id").asText(), List.of());
    if (list.isEmpty() && numeric(post, "total") != 0) throw new IllegalArgumentException("A priced post without calculation rows cannot be represented in WPCalc without changing its type");
    if (post.path("rowType").asText().equals("bewakingspost") && numeric(post, "quantity") != 0 && numeric(post, "quantity") != 1) throw new IllegalArgumentException("WPCalc cannot preserve a multiplied bewakingspost");
    result.put(post.path("id").asText(), new Position(group, paragraph, 0, 4, depth));
    int seq = 0;
    for (JsonNode child : list) leaf(child, children, result, group, paragraph, ++seq, depth + 1);
  }

  private static void leaf(JsonNode item, Map<String, List<JsonNode>> children, Map<String, Position> result, int group, int paragraph, int sequence, int depth) {
    String type = item.path("rowType").asText();
    if (!List.of("regel", "tekstregel", "witregel").contains(type) || !children.getOrDefault(item.path("id").asText(), List.of()).isEmpty()) throw new IllegalArgumentException("Nested posts/chapters cannot be represented faithfully by WPCalc");
    if (group > 32767 || paragraph > 32767 || sequence > 32767) throw new IllegalArgumentException("WPCalc hierarchy exceeds numeric field limits");
    result.put(item.path("id").asText(), new Position(group, paragraph, sequence, type.equals("regel") ? 0 : 5, depth));
  }

  private static Map<String, Object> dataValues(JsonNode item, JsonNode schedule, Position pos, int doc, int rec, Row original, Map<String, Double> originalRates) {
    Map<String, Object> result = new HashMap<>();
    result.put("recnr", rec); result.put("docnr", doc); result.put("groep", pos.group); result.put("paragraaf", pos.paragraph); result.put("volgnr", pos.sequence); result.put("tabs", Math.max(0, pos.depth - 1)); result.put("rectype", pos.type);
    if (original != null && number(original.get("groep")) == pos.group && number(original.get("paragraaf")) == pos.paragraph && number(original.get("volgnr")) == pos.sequence && number(original.get("rectype")) == pos.type) result.put("tabs", original.get("tabs"));
    result.put("omschrijving", item.path("description").asText("")); result.put("code", item.path("code").asText(""));
    if (original != null && original.get("code") == null && item.path("code").asText("").isEmpty()) result.put("code", null);
    if (original != null && (pos.type == 4 || pos.type == 8)) {
      if (number(original.get("rectype")) != pos.type) throw new IllegalArgumentException("Changing the type of an original WPCalc container needs a verified mapping");
      if (numeric(item, "normUnitPrice") != 0 || numeric(item, "materialPrice") != 0 || numeric(item, "laborPrice") != 0) throw new IllegalArgumentException("Changing original WPCalc container pricing needs a verified mapping");
      if (!item.path("quantity").isNull() && !item.path("quantity").isMissingNode() && original.get("aantal") instanceof Number amount && numeric(item, "quantity") != amount.doubleValue()) throw new IllegalArgumentException("Changing original WPCalc container quantities needs a verified mapping");
      return result;
    }
    if (original != null && number(original.get("rectype")) == 0 && List.of("tekstregel", "witregel").contains(item.path("rowType").asText())) {
      if (original.get("kosteneh") instanceof Number amount && amount.doubleValue() != 0) throw new IllegalArgumentException("Changing a priced original WPCalc row into text requires an explicit pricing removal mapping");
      return result;
    }
    String unit = item.path("unit").asText("");
    result.put("eenheid", switch (unit) { case "m²" -> "m2"; case "m³" -> "m3"; case "m" -> "m1"; default -> unit; });
    if (original != null && item.path("wpcalcNativeUnit").isTextual() && unit.equals(item.path("wpcalcNativeUnit").asText())) result.put("eenheid", original.get("eenheid"));
    double quantity = pos.type == 0 || pos.type == 4 ? numeric(item, "quantity") : 0;
    double price = pos.type == 0 ? numeric(item, "normUnitPrice") : 0;
    double labor = pos.type == 0 ? numeric(item, "laborPrice") : 0;
    double norm = pos.type == 0 ? numeric(item, "normQuantity") : 0;
    boolean uncalculated = item.path("wpcalcUncalculatedPrice").asBoolean(false);
    if (uncalculated) {
      if (original == null || original.get("kosteneh") != null) throw new IllegalArgumentException("An uncalculated WPCalc price requires its original source row");
      double oldQuantity = original.get("aantal") instanceof Number value ? value.doubleValue() : 0;
      double oldNorm = original.get("norm") instanceof Number value ? value.doubleValue() : 0;
      if (quantity != oldQuantity || price != 0 || numeric(item, "total") != 0 || norm != oldNorm || labor != 0) throw new IllegalArgumentException("Activate the original uncalculated WPCalc price before changing quantity or pricing");
    }
    if (original != null && !uncalculated && original.get("prijs") instanceof Number oldPrice && Math.abs(oldPrice.doubleValue() - price) > 0.000001) {
      for (String component : List.of("bruto", "korting", "inkoop", "toeslag", "usprijs")) {
        if (original.get(component) instanceof Number value && value.doubleValue() != 0) throw new IllegalArgumentException("This source price has purchasing/discount components; changing its final price needs a verified component mapping");
      }
    }
    if (pos.type == 0 && norm == 0 && labor != 0) throw new IllegalArgumentException("WPCalc export cannot preserve manual labor without a production norm; export the native document instead");
    boolean linkedRate = !item.path("tariefGroep").isNull() && !item.path("tariefGroep").isMissingNode();
    String rateGroup = linkedRate ? item.path("tariefGroep").asText() : item.path("wpcalcRateGroup").asText("A");
    double rate = linkedRate ? numeric(schedule.path("tarieven"), rateGroup) : norm != 0 ? labor / norm : labor;
    if (!uncalculated && Math.abs(norm * rate - labor) > 0.000001) throw new IllegalArgumentException("Labor rate does not match the calculated row: " + item.path("description").asText());
    if (!uncalculated && pos.type == 0 && Math.abs(quantity * (price + labor) - numeric(item, "total")) > 0.011) throw new IllegalArgumentException("This row uses resource-based norms that WPCalc cannot represent faithfully: " + item.path("description").asText());
    if (!uncalculated) { result.put("aantal", quantity); result.put("prijs", price); result.put("kosteneh", price + labor); result.put("norm", norm); result.put("tarief", linkedRate ? 0d : rate); result.put("tariefgroep", rateGroup); }
    String resource = item.path("resourceType").asText("");
    result.put("onderaanneming", resource.equals("onderaannemer")); result.put("materieel", resource.equals("materieel")); result.put("stelpost", resource.equals("overig")); result.put("vastbedrag", false);
    if (original != null) {
      if (linkedRate && original.get("tarief") == null) result.put("tarief", null);
      double oldPrice = original.get("prijs") instanceof Number value ? value.doubleValue() : 0;
      double oldNorm = original.get("norm") instanceof Number value ? value.doubleValue() : 0;
      double oldRate = original.get("tarief") instanceof Number value ? value.doubleValue() : 0;
      if (oldRate == 0) oldRate = originalRates.getOrDefault(Objects.toString(original.get("tariefgroep"), "A"), 0d);
      if (!uncalculated && (original.get("kosteneh") != null || (oldPrice == 0 && oldNorm * oldRate == 0)) && price == oldPrice && norm == oldNorm && Math.abs(labor - oldNorm * oldRate) < 1e-8) result.put("kosteneh", original.get("kosteneh"));
      for (String flag : List.of("onderaanneming", "materieel", "stelpost", "vastbedrag")) if (Boolean.FALSE.equals(result.get(flag)) && original.get(flag) == null) result.put(flag, null);
      for (String field : List.of("aantal", "prijs", "norm")) {
        String nativeField = field.equals("aantal") ? "quantity" : field.equals("prijs") ? "normUnitPrice" : "normQuantity";
        if (original.get(field) == null && (item.path(nativeField).isNull() || item.path(nativeField).isMissingNode())) result.put(field, null);
      }
    }
    return result;
  }

  private static void writeRates(Table table, JsonNode schedule, int doc) throws IOException {
    Map<String, Row> old = new HashMap<>();
    for (Row row : rows(table)) if (number(row.get("docnr")) == -1 || number(row.get("docnr")) == doc) old.put(Objects.toString(row.get("tariefgroep"), ""), row);
    var fields = schedule.path("tarieven").fields();
    int ascii = 65;
    while (fields.hasNext()) {
      var entry = fields.next();
      Map<String, Object> values = new HashMap<>();
      values.put("docnr", old.containsKey(entry.getKey()) ? old.get(entry.getKey()).get("docnr") : doc); values.put("asciinr", old.containsKey(entry.getKey()) ? old.get(entry.getKey()).get("asciinr") : ascii); ascii++; values.put("tariefgroep", entry.getKey()); values.put("tarief", entry.getValue().asDouble()); values.put("uurtarief", true);
      if (old.containsKey(entry.getKey())) update(table, old.get(entry.getKey()), values); else insert(table, values);
    }
  }

  private static void writeHours(Table table, List<JsonNode> items, int doc) throws IOException {
    if (table == null) return;
    Map<String, double[]> groups = new TreeMap<>();
    for (JsonNode item : items) {
      if (!item.path("rowType").asText().equals("regel") || item.path("wpcalcUncalculatedPrice").asBoolean(false)) continue;
      double hours = numeric(item, "quantity") * numeric(item, "normQuantity");
      double amount = numeric(item, "quantity") * numeric(item, "laborPrice");
      if (hours == 0 && amount == 0) continue;
      String group = item.path("tariefGroep").isTextual() ? item.path("tariefGroep").asText() : item.path("wpcalcRateGroup").asText("");
      double[] totals = groups.computeIfAbsent(group, ignored -> new double[2]); totals[0] += hours; totals[1] += amount;
    }
    List<Row> originals = rows(table);
    int next = originals.stream().mapToInt(row -> number(row.get("recnr"))).max().orElse(0) + 1;
    Map<String, Row> existing = new HashMap<>();
    Row summary = null;
    for (Row row : originals) {
      if (number(row.get("docnr")) != doc) continue;
      String group = Objects.toString(row.get("tariefgroep"), "");
      if (group.isBlank()) {
        if (summary != null) throw new IllegalArgumentException("Multiple custom hour summary records require a verified mapping");
        summary = row;
      } else if (existing.put(group, row) != null) throw new IllegalArgumentException("Duplicate source hour groups require a verified mapping");
    }
    double totalHours = 0, totalAmount = 0;
    Set<String> names = new TreeSet<>(existing.keySet()); names.addAll(groups.keySet()); int sequence = 1;
    for (String group : names) {
      double[] values = groups.getOrDefault(group, new double[2]);
      Map<String, Object> row = new HashMap<>(); row.put("docnr", doc); row.put("tariefgroep", group); row.put("aantal", values[0]); row.put("bedrag", values[1]); row.put("tarief", values[0] == 0 ? 0 : values[1] / values[0]);
      Row old = existing.get(group);
      if (old != null) update(table, old, row); else { row.put("recnr", next++); row.put("volgnr", sequence); row.put("omschrijving", group); insert(table, row); }
      totalHours += values[0]; totalAmount += values[1]; sequence++;
    }
    Map<String, Object> values = new HashMap<>(); values.put("docnr", doc); values.put("aantal", totalHours); values.put("bedrag", totalAmount);
    if (summary != null) update(table, summary, values);
    else if (!names.isEmpty()) { values.put("recnr", next); values.put("volgnr", sequence); values.put("omschrijving", "Totaal uren"); insert(table, values); }
  }

  private static void writeTail(Table table, List<JsonNode> items, int doc, JsonNode source) throws IOException {
    List<Row> old = rows(table);
    int rec = old.stream().mapToInt(row -> number(row.get("recnr"))).max().orElse(0) + 1;
    Map<String, Row> byLabel = new HashMap<>();
    Map<Integer, Row> byId = new HashMap<>();
    Set<Integer> retained = new HashSet<>();
    Map<String, Double> directColumns = new HashMap<>();
    Map<String, Object> resource = resourceTotals(items);
    for (String column : List.of("loon", "materiaal", "materieel", "stelpost", "onderaanneming")) directColumns.put(column, (double)resource.get("totaal" + (column.equals("stelpost") ? "stelposten" : column)));
    Map<String, Double> costColumns = new HashMap<>(directColumns);
    double direct = items.stream().filter(item -> item.path("parentId").isNull() && !item.path("rowType").asText().startsWith("staart_")).mapToDouble(item -> numeric(item, "total")).sum();
    double costPrice = direct, excluding = direct, including = direct;
    for (JsonNode item : items) if (item.path("rowType").asText().startsWith("staart_")) {
      including += numeric(item, "total");
      if (!item.path("rowType").asText().startsWith("staart_btw")) excluding += numeric(item, "total");
    }
    for (Row row : old) if (number(row.get("docnr")) == doc) byLabel.put(Objects.toString(row.get("omschrijving"), "").toLowerCase(Locale.ROOT), row);
    for (Row row : old) if (number(row.get("docnr")) == doc) byId.put(number(row.get("recnr")), row);
    int seq = 10, firstAmountSequence = -1, firstVatSequence = -1;
    for (JsonNode item : items) {
      String type = item.path("rowType").asText();
      if (!type.startsWith("staart_")) continue;
      if (type.equals("staart_afronding")) continue;
      int itemtype = type.startsWith("staart_btw") ? 256 : List.of("staart_ak_oa", "staart_abk", "staart_garanties", "staart_wvpm", "staart_ukk").contains(type) ? 1 : 8;
      String label = item.path("description").asText(type);
      Row original = byId.get(item.path("wpcalcStaartRowId").asInt(-1));
      if (original == null && !source.has("importedStaartRowIds")) original = byLabel.get(label.toLowerCase(Locale.ROOT));
      if (original == null && source.isObject()) throw new IllegalArgumentException("Adding new surcharge rows to an original WPCalc tail requires an explicit section-order mapping");
      if (original != null && !retained.add(number(original.get("recnr")))) throw new IllegalArgumentException("Duplicate original WPCalc surcharge identifier");
      if (original != null) itemtype = number(original.get("itemtype"));
      if (itemtype == 8 && firstAmountSequence < 0) firstAmountSequence = seq;
      if (itemtype == 256 && firstVatSequence < 0) firstVatSequence = seq;
      Map<String, Object> values = new HashMap<>();
      values.put("recnr", original == null ? rec++ : original.get("recnr")); values.put("docnr", doc); values.put("volgnr", original == null ? seq : original.get("volgnr")); seq += 10; values.put("itemtype", itemtype); values.put("omschrijving", label); values.put("code", original == null ? "peercalc:" + type : original.get("code")); values.put("percentage", numeric(item, "staartPercentage") / 100);
      JsonNode breakdown = item.path("staartItemBreakdown");
      for (String column : List.of("loon", "materiaal", "materieel", "stelpost", "onderaanneming", "bedrag", "subtotaal", "totaal")) values.put(column, numeric(breakdown, column));
      values.put("subtotaal", numeric(item, "total"));
      if (original == null) values.put("itemstyle", itemtype == 1 ? type.equals("staart_ak_oa") ? 64 : List.of("staart_abk", "staart_garanties", "staart_wvpm").contains(type) ? 7 : 79 : 32);
      if (itemtype == 1) {
        double allocated = 0;
        if (number(original == null ? values.get("itemstyle") : original.get("itemstyle")) == 79) {
          for (String column : costColumns.keySet()) { double amount = costColumns.get(column) * numeric(item, "staartPercentage") / 100; values.put(column, amount); allocated += amount; }
        } else {
          for (String column : costColumns.keySet()) allocated += (double)values.get(column);
        }
        if (Math.abs(allocated - numeric(item, "total")) > 0.011) throw new IllegalArgumentException("This WPCalc resource surcharge needs a verified per-column mapping");
        for (String column : costColumns.keySet()) costColumns.put(column, costColumns.get(column) + (double)values.get(column));
        costPrice += numeric(item, "total");
      }
      if (original == null) insert(table, values); else update(table, original, values);
    }
    Set<Integer> managed = new HashSet<>();
    source.path("importedStaartRowIds").forEach(id -> managed.add(id.asInt()));
    for (Row row : old) if (number(row.get("docnr")) == doc && managed.contains(number(row.get("recnr"))) && !retained.contains(number(row.get("recnr")))) table.deleteRow(row);
    Set<Integer> summaries = new HashSet<>();
    for (Row row : old) {
      if (number(row.get("docnr")) != doc || retained.contains(number(row.get("recnr")))) continue;
      int type = number(row.get("itemtype"));
      if (!List.of(32, 4, 64, 128).contains(type)) continue;
      if (!summaries.add(type)) throw new IllegalArgumentException("Multiple source total rows need an explicit section-total mapping");
      Map<String, Object> values = new HashMap<>();
      values.put("totaal", type == 32 ? direct : type == 4 ? costPrice : type == 64 ? excluding : including);
      if (type == 32 || type == 4) values.putAll(type == 32 ? directColumns : costColumns);
      update(table, row, values);
    }
    if (!source.isObject()) {
      for (int type : List.of(32, 4, 64, 128)) {
        Map<String, Object> values = new HashMap<>(); values.put("recnr", rec++); values.put("docnr", doc); values.put("itemtype", type); values.put("volgnr", type == 32 ? 0 : type == 4 ? firstAmountSequence > 0 ? firstAmountSequence - 2 : firstVatSequence > 0 ? firstVatSequence - 2 : seq : type == 64 ? firstVatSequence > 0 ? firstVatSequence - 1 : seq + 1 : seq + 10);
        values.put("omschrijving", type == 32 ? "Totaal kolommen:" : type == 4 ? "Totaal kostprijs:" : type == 64 ? "Totaal excl. btw:" : "Totaal incl. btw:");
        values.put("totaal", type == 32 ? direct : type == 4 ? costPrice : type == 64 ? excluding : including);
        if (type == 32 || type == 4) values.putAll(type == 32 ? directColumns : costColumns);
        insert(table, values);
      }
    }
  }

  private static List<Row> rows(Table table) { List<Row> result = new ArrayList<>(); table.forEach(result::add); return result; }
  private static Map<String, Object> resourceTotals(List<JsonNode> items) {
    Map<String, Object> totals = new HashMap<>();
    for (String field : List.of("totaalloon", "totaalmateriaal", "totaalmaterieel", "totaalonderaanneming", "totaalstelposten", "totaaluren")) totals.put(field, 0d);
    for (JsonNode item : items) {
      if (!item.path("rowType").asText().equals("regel")) continue;
      double quantity = numeric(item, "quantity"), amount = numeric(item, "total");
      double labor = numeric(item, "laborPrice") * quantity;
      double material = numeric(item, "normUnitPrice") * quantity;
      double hours = quantity * numeric(item, "normQuantity");
      totals.put("totaaluren", (double)totals.get("totaaluren") + hours);
      String resource = item.path("resourceType").asText("");
      String column = switch (resource) { case "onderaannemer" -> "totaalonderaanneming"; case "arbeid" -> "totaalloon"; case "materieel" -> "totaalmaterieel"; case "overig" -> "totaalstelposten"; default -> "totaalmateriaal"; };
      if (!resource.equals("arbeid") && Math.abs(labor + material - amount) < 0.01 && labor + material > 0) {
        totals.put("totaalloon", (double)totals.get("totaalloon") + labor);
        amount = material;
      }
      totals.put(column, (double)totals.get(column) + amount);
    }
    return totals;
  }
  private static double vatRate(List<JsonNode> items, String type, double fallback) {
    Double rate = null;
    for (JsonNode item : items) if (item.path("rowType").asText().equals(type)) {
      double value = numeric(item, "staartPercentage") / 100;
      if (rate != null && Math.abs(rate - value) > 0.000001) throw new IllegalArgumentException("WPCalc cannot preserve multiple distinct rates for one VAT classification");
      rate = value;
    }
    return rate == null ? fallback : rate;
  }
  private static int number(Object value) { return value instanceof Number number ? number.intValue() : 0; }
  private static double numeric(JsonNode node, String field) {
    JsonNode value = node.path(field);
    if (value.isMissingNode() || value.isNull()) return 0;
    if (!value.isNumber() || !Double.isFinite(value.asDouble())) throw new IllegalArgumentException("Invalid number: " + field);
    return value.asDouble();
  }
  private static void insert(Table table, Map<String, Object> values) throws IOException { table.addRowFromMap(values); }
  private static void update(Table table, Row row, Map<String, Object> values) throws IOException { row.putAll(values); table.updateRow(row); }
}
