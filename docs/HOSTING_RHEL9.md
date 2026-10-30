# Hosting Op RHEL 9

Het script installeert een aparte Docker-hostingomgeving voor een publiek
domein. Het publiceert alleen TCP 80 en 443, met automatische HTTPS via Caddy.
De lokale `compose.yaml`, `.env` en bestaande lokale volumes worden niet gebruikt
of gemigreerd. Gebruik een aparte server/installatie voor hosting.

## Vooraf

- RHEL 9 met root/sudo, werkende RHEL-repositories en voldoende RAM en
  schijfruimte voor de lokale builds en acht containers.
- Zet de A- en eventuele AAAA-records van het domein naar deze server. Verwijder
  een AAAA-record dat naar een andere of onbereikbare server wijst.
- Maak TCP 80/443 bereikbaar in de providerfirewall, router en serverfirewall.
  Er mag nog geen andere webserver op die poorten luisteren.
- Een actuele Docker Engine met Compose-plugin wordt geinstalleerd als Docker
  ontbreekt. Bestaande Podman/runc-installaties worden niet verwijderd. Los
  packageconflicten eerst bewust op volgens de [Docker RHEL-installatiegids](https://docs.docker.com/engine/install/rhel/).

## Installeren

```sh
sudo dnf -y install git
sudo git clone https://github.com/Kindo-B-V/peercalc.git /opt/peercalc
cd /opt/peercalc
sudo ./scripts/host-rhel9.sh calculatie.jouwdomein.nl
```

Zonder argument vraagt het script om de domeinnaam. Geef alleen de hostnaam,
zonder `https://`, poort, wildcard of pad. Gebruik ASCII/punycode voor een IDN.
Optioneel geef je bij de eerste installatie een bestaand contactadres voor de
certificaatbeheerder mee:

```sh
sudo ACME_EMAIL=beheer@jouwdomein.nl ./scripts/host-rhel9.sh calculatie.jouwdomein.nl
```

Zonder dit adres gebruikt de configuratie `owner@<domein>` als ACME-contactadres;
zorg dan dat die mailbox/alias bestaat. [Caddy vraagt certificaten aan en vernieuwt ze](https://caddyserver.com/docs/automatic-https/).
Het script wacht op een geldig certificaat voor deze server en controleert dat
anonieme toegang tot de projecten-API wordt geweigerd. Het gebruikt daarbij geen
`curl -k` en schakelt SELinux niet uit. Bestandsmounts krijgen SELinux-labels.

Als firewalld draait, opent het script `http` en `https` in de standaardzone,
zowel direct als permanent. Het herlaadt geen andere firewallregels en zet een
uitgeschakelde firewall niet aan, om onder andere SSH-toegang niet te verbreken.
Controleer zelf of je netwerkinterface een andere zone gebruikt. Docker- en
providerfirewallregels blijven een verantwoordelijkheid van de serverbeheerder.

## Aanmelden En Beheren

Open `https://<domein>`. Het eerste account is `owner@<domein>`. Het wachtwoord
staat als `PEERCALC_OWNER_PASSWORD` in `/opt/peercalc/.env.hosting` (mode 0600).
Deze lokale loginnaam maakt geen echte mailbox aan. Secrets worden niet in de
terminal afgedrukt en bij opnieuw uitvoeren niet vervangen.

Registratie en wachtwoordherstel per e-mail staan uit. De eerste eigenaar is
vooraf als geverifieerd ingesteld. Maak alleen vertrouwde extra accounts aan
via beheer; configureer SMTP en een passende verificatieprocedure voordat je
zelfregistratie of e-mailherstel inschakelt. Accounts worden geautoriseerd met
hun vaste OIDC-ID, niet alleen hun e-mailadres.

De publieke Keycloak-beheerpagina en de master-realm zijn geblokkeerd. Gebruik
SSH en de interne beheer-CLI. Onderstaand commando vraagt interactief om het
bootstrap-beheerwachtwoord uit `PEERCALC_ADMIN_PASSWORD`:

```sh
cd /opt/peercalc
sudo docker compose --env-file .env.hosting -f compose.hosting.yaml exec identity \
  /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://127.0.0.1:8080/auth --realm master --user admin
```

Gebruik daarna de Keycloak-beheer-CLI voor accountbeheer. De bootstrap-admin is
bedoeld voor de eerste inrichting; maak een eigen beheerder aan volgens de
[Keycloak-bootstrapdocumentatie](https://www.keycloak.org/server/bootstrap-admin-recovery).
SMTP, gebruikersbeheer en wachtwoordrotatie zijn geen geautomatiseerde onderdelen
van dit script. Een wachtwoord in het env-bestand wijzigen verandert een reeds
geimporteerde Keycloak-gebruiker of bestaande PostgreSQL-gebruiker niet.

## Bedienen En Bijwerken

Voer hostingcommando's altijd uit met het hostingbestand en de hosting-secrets:

```sh
cd /opt/peercalc
sudo docker compose --env-file .env.hosting -f compose.hosting.yaml ps
sudo docker compose --env-file .env.hosting -f compose.hosting.yaml logs --tail=100 edge gateway identity
```

Na een geteste bronupdate en back-up:

```sh
sudo git pull --ff-only
sudo ./scripts/host-rhel9.sh calculatie.jouwdomein.nl
```

Het script draait de versie uit deze checkout; het voert niet zelf `git pull`
uit. Voor het bewust verversen van basisimages gebruik je `docker compose`
met de hostingflags en respectievelijk `pull` en `build --pull`, voordat je het
script opnieuw uitvoert. Review release- en migratie-instructies vooraf.

Het installatiescript gebruikt expliciet de lokale Docker-socket en het project
`peercalc-hosting`, ongeacht je actieve Docker-context. Het negeert geexporteerde
hostingvariabelen nadat `.env.hosting` is gelezen. Bij handmatige Compose-
commando's moet je zelf controleren dat je lokale context actief is en dat er
geen geexporteerde `PEERCALC_*`, `CALC_CONVERTER_TOKEN` of `ACME_EMAIL` over de
bewaarde env-waarden heen gaan.

Docker start bij een reboot; services hebben `restart: unless-stopped`. Controleer
na een reboot de status en de website. Het opnieuw uitvoeren van hetzelfde script
behoudt wachtwoorden, database, documenten en certificaten. Een andere domeinnaam
wordt geweigerd om een onbedoelde OIDC-migratie te voorkomen. Voor een echte
domeinmigratie moeten DNS, hostname, client-redirects en cookies samen veranderen.

## Data En Back-ups

Compose-project `peercalc-hosting` gebruikt eigen volumes voor documenten,
PostgreSQL-identiteiten, Redis-sessies en Caddy-certificaten/configuratie. Alleen
Caddy heeft gepubliceerde netwerkpoorten. Interne HTTP-verbindingen lopen op het
private Docker-netwerk; de browser gebruikt HTTPS en secure cookies.

Maak voordat je klantdata opslaat een versleutelde, externe back-up met een
geteste herstelprocedure. Neem `.env.hosting`, de checkout-versie, realmconfig en
de persistente volumes mee. Stop services voor consistente bestandsback-ups;
gebruik voor een live PostgreSQL-back-up een geschikte databaseback-upmethode.
Bewaar deze bestanden nooit in Git of publieke supportbijlagen. **Gebruik geen
`docker compose down -v`: dat verwijdert data, accounts en certificaten.**

TLS en een productie-identiteitsdatabase zijn geen volledige security-audit.
Het bestaande applicatieruntime gebruikt Wrangler/workerd met lokale D1/R2-
opslag in Docker: dit is een enkele server, geen beheerde of hoogbeschikbare
clouddatabase. Regel monitoring, OS/image-updates, schijfversleuteling,
back-ups, bewaartermijnen en capaciteit voordat je er zakelijk op vertrouwt.

## Verificatiegrens

Het script en de configuratie krijgen automatische tests, plus een geisoleerde
HTTPS-test van de containerstack. Installatie op een echte RHEL 9-machine,
SELinux enforcing, provider-DNS/firewall en publieke ACME-uitgifte moeten op de
doelserver worden gecontroleerd. Er is geen externe server door dit werk gehost.
De bestaande beperkingen van WPCalc-uitwisseling blijven gelden; zie
[FORMAT.md](../converter/FORMAT.md) en [SECURITY.md](../SECURITY.md).
