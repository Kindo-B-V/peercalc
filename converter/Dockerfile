FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src src
COPY scripts scripts
COPY patches patches
COPY NOTICE NOTICE
COPY LICENSES LICENSES
RUN mvn -B package

FROM eclipse-temurin:17-jre-jammy
RUN useradd --create-home --uid 10001 peercalc
WORKDIR /app
COPY --from=build /build/target/peercalc-converter-0.1.0.jar converter.jar
COPY --from=build /build/NOTICE NOTICE
COPY --from=build /build/LICENSES LICENSES
USER peercalc
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["java", "-Xmx256m", "-jar", "converter.jar"]
