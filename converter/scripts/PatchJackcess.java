import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.zip.ZipFile;

class PatchJackcess {
  public static void main(String[] args) throws Exception {
    Path jar = Path.of(args[0]);
    String checksum = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(jar)));
    if (!checksum.equals("4de1bc2f1663b0946ce39057dd90eace355f4f74b8f818c0fe167f0c65815428")) throw new IllegalStateException("Unexpected Jackcess source checksum; review the compatibility patch before upgrading");
    String entry = "com/healthmarketscience/jackcess/impl/IndexData.java";
    String source;
    try (ZipFile archive = new ZipFile(jar.toFile())) {
      source = new String(archive.getInputStream(archive.getEntry(entry)).readAllBytes(), StandardCharsets.UTF_8);
    }
    String anchor = "    UpdateRowPendingChange change = new UpdateRowPendingChange(nextChange);";
    if (source.indexOf(anchor) < 0 || source.indexOf(anchor) != source.lastIndexOf(anchor)) throw new IllegalStateException("Unexpected Jackcess patch location");
    String insertion = "    // PeerCalc: the same row id and encoded keys require no index mutation.\n"
      + "    if(Arrays.equals(createEntryBytes(oldRow), createEntryBytes(newRow))) {\n"
      + "      return nextChange;\n"
      + "    }\n\n";
    source = source.replace(anchor, insertion + anchor);
    source = "// Modified by PeerCalc: skip only byte-identical encoded index-key updates.\n" + source;
    Path output = Path.of(args[1]).resolve(entry);
    Files.createDirectories(output.getParent());
    Files.writeString(output, source, StandardCharsets.UTF_8);
  }
}
