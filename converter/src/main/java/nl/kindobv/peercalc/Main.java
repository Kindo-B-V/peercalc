package nl.kindobv.peercalc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

public final class Main {
  private static final int MAX_BYTES = 20 * 1024 * 1024;
  private static final ObjectMapper JSON = new ObjectMapper();

  public static void main(String[] args) throws IOException {
    String token = System.getenv("CALC_CONVERTER_TOKEN");
    if (token == null || token.length() < 32) throw new IllegalStateException("CALC_CONVERTER_TOKEN must contain at least 32 characters");
    byte[] expected = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
    Semaphore slots = new Semaphore(2);
    HttpServer server = HttpServer.create(new InetSocketAddress(Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"))), 32);
    server.setExecutor(Executors.newFixedThreadPool(4));
    server.createContext("/health", exchange -> respond(exchange, 200, "ok".getBytes(StandardCharsets.UTF_8), "text/plain"));
    server.createContext("/export", exchange -> {
      String authorization = exchange.getRequestHeaders().getFirst("Authorization");
      if (authorization == null || !MessageDigest.isEqual(expected, authorization.getBytes(StandardCharsets.UTF_8))) { respond(exchange, 401, new byte[0], "text/plain"); return; }
      if (!exchange.getRequestURI().getPath().equals("/export") || !exchange.getRequestMethod().equals("POST")) { respond(exchange, 405, new byte[0], "text/plain"); return; }
      if (!slots.tryAcquire()) { respond(exchange, 429, "Converter busy".getBytes(StandardCharsets.UTF_8), "text/plain"); return; }
      try {
        byte[] body = exchange.getRequestBody().readNBytes(MAX_BYTES + 1);
        if (body.length > MAX_BYTES) { respond(exchange, 413, "Request exceeds 20 MiB".getBytes(StandardCharsets.UTF_8), "text/plain"); return; }
        byte[] result = Converter.convert(JSON.readTree(body));
        exchange.getResponseHeaders().set("Content-Disposition", "attachment; filename=begroting.calc");
        respond(exchange, 200, result, "application/vnd.ms-access");
      } catch (IllegalArgumentException error) {
        respond(exchange, 422, JSON.writeValueAsBytes(java.util.Map.of("error", error.getMessage())), "application/json");
      } catch (Exception error) {
        boolean indexFailure = java.util.Arrays.stream(error.getStackTrace()).anyMatch(frame -> frame.getClassName().startsWith("com.healthmarketscience.jackcess.impl.IndexPageCache"));
        if (indexFailure) {
          respond(exchange, 422, JSON.writeValueAsBytes(java.util.Map.of("error", "The original WPCalc index cannot safely apply this structural change; the source file has not been modified", "code", "SOURCE_INDEX_UNSUPPORTED")), "application/json");
          return;
        }
        System.err.println("Conversion failed: " + error.getClass().getSimpleName());
        respond(exchange, 500, "Conversion failed".getBytes(StandardCharsets.UTF_8), "text/plain");
      } finally { slots.release(); exchange.close(); }
    });
    server.start();
  }

  private static void respond(HttpExchange exchange, int status, byte[] bytes, String type) throws IOException {
    exchange.getResponseHeaders().set("Content-Type", type);
    exchange.getResponseHeaders().set("Cache-Control", "no-store");
    exchange.sendResponseHeaders(status, bytes.length);
    try (var output = exchange.getResponseBody()) { output.write(bytes); }
    exchange.close();
  }
}
