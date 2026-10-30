package nl.kindobv.peercalc;

import com.healthmarketscience.jackcess.*;
import com.healthmarketscience.jackcess.impl.IndexImpl;
import org.junit.jupiter.api.Test;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class JackcessIndexPatchTest {
  @Test void unchangedKeysRetainIndexesAndChangedKeysStillEnforceConstraints() throws Exception {
    Path file = Files.createTempFile("index-patch-", ".mdb"); Files.delete(file);
    try (Database db = DatabaseBuilder.create(Database.FileFormat.V2000, file.toFile())) {
      Table table = new TableBuilder("items")
        .addColumn(new ColumnBuilder("id", DataType.LONG))
        .addColumn(new ColumnBuilder("group", DataType.TEXT))
        .addColumn(new ColumnBuilder("code", DataType.TEXT))
        .addColumn(new ColumnBuilder("price", DataType.DOUBLE))
        .addIndex(new IndexBuilder("primary").addColumns("id").setPrimaryKey())
        .addIndex(new IndexBuilder("composite").addColumns("group", "code").setUnique().setIgnoreNulls())
        .toTable(db);
      table.addRow(1, "A", "one", 10d); table.addRow(2, "A", "two", 20d); table.addRow(3, null, null, 30d);
      Row first = CursorBuilder.findRow(table, Map.of("id", 1));
      first.put("price", 15d); table.updateRow(first);
      assertEquals(15d, ((Number)CursorBuilder.findRow(table, Map.of("id", 1)).get("price")).doubleValue());
      first = CursorBuilder.findRow(table, Map.of("id", 1)); first.put("code", "three"); table.updateRow(first);
      assertNotNull(CursorBuilder.createCursor(table.getIndex("composite")).findRowByEntry("A", "three"));
      Row duplicate = CursorBuilder.findRow(table, Map.of("id", 2)); duplicate.put("code", "three");
      assertThrows(ConstraintViolationException.class, () -> table.updateRow(duplicate));
      Row required = CursorBuilder.findRow(table, Map.of("id", 2)); required.put("id", null);
      assertThrows(ConstraintViolationException.class, () -> table.updateRow(required));
      Row ignored = CursorBuilder.findRow(table, Map.of("id", 3)); ignored.put("price", 31d); table.updateRow(ignored);
      assertEquals(31d, ((Number)CursorBuilder.findRow(table, Map.of("id", 3)).get("price")).doubleValue());
      for (Index index : table.getIndexes()) ((IndexImpl)index).getIndexData().validate(true);
    } finally { Files.deleteIfExists(file); }
  }

  @Test void keyChangesStillEnforceForeignKeys() throws Exception {
    Path file = Files.createTempFile("index-fk-", ".mdb"); Files.delete(file);
    try (Database db = DatabaseBuilder.create(Database.FileFormat.V2000, file.toFile())) {
      db.setEnforceForeignKeys(true);
      Table parents = new TableBuilder("parents").addColumn(new ColumnBuilder("id", DataType.LONG)).addIndex(new IndexBuilder("parent-pk").addColumns("id").setPrimaryKey()).toTable(db);
      Table children = new TableBuilder("children").addColumn(new ColumnBuilder("parent", DataType.LONG)).addColumn(new ColumnBuilder("price", DataType.DOUBLE)).toTable(db);
      parents.addRow(1); children.addRow(1, 10d);
      new RelationshipBuilder("parents", "children").addColumns("id", "parent").setReferentialIntegrity().toRelationship(db);
      Row child = children.iterator().next(); child.put("price", 11d); children.updateRow(child);
      child = children.iterator().next(); child.put("parent", 999); Row invalid = child;
      assertThrows(ConstraintViolationException.class, () -> children.updateRow(invalid));
      for (Index index : children.getIndexes()) ((IndexImpl)index).getIndexData().validate(true);
    } finally { Files.deleteIfExists(file); }
  }
}
