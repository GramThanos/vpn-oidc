# VPN-OIDC
## VPN Authentication through Open ID Connect using OpenVPN

![demo](preview.gif)

This project is a PoC implementation of VPN authentication through online web-based Open ID Connect authentication.
The VPN server plays the role of a web-application and the custom VPN Client acts as a bridge between the web authentication and the VPN server.

The authentication process follows the following steps:
- The client initialise an Open ID Connect (OIDC) authentication on one of the available services (e.g. Facebook login, Google login)
- The user authenticates using the service's web authentication method (e.g. Username+Password, FIDO2/WebAuthn, TOTP, HOTP ...)
- On successful authentication the client forwards the generated authentication token to the VPN server
- The VPN server validates the authentication token with the Open ID Connect service, retrieves user's identity information

This implementation allows the use of single- or multi-factor secure and strong authentication for VPN services through state of the art web-based authentication method (like FIDO2/WebAuthn) as long as the service supports Open ID Connect (OIDC).

## Prepare VPN Server

Upgrade your system:
```console
sudo apt update && sudo apt upgrade -y
```

Download and run OpenVPN installation script:
```console
wget https://git.io/vpn -O openvpn-install.sh
chmod +x openvpn-install.sh
sudo bash openvpn-install.sh
```

Copy custom authentication script (`server/auth.py` from this project) and make it executable:
```console
sudo cp server/auth.py /etc/openvpn/server/auth.py
sudo chmod +x /etc/openvpn/server/auth.py
```
Don't forget to add your Open ID Connect secrets inside it.

Edit the server's configuration
```console
sudo nano /etc/openvpn/server/server.conf
```
Add the following lines to the bottom of the config:
```conf
script-security 3
auth-user-pass-verify auth.py via-env
username-as-common-name
client-cert-not-required
verify-client-cert none
```

Copy the generated OpenVPN client profile:
```console
sudo cat /root/client.ovpn
```

Example OpenVPN client profile:
```conf
client
dev tun
proto udp
remote 11.22.33.44 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth SHA512
cipher AES-256-CBC
ignore-unknown-option block-outside-dns
block-outside-dns
verb 3
<ca>
-----BEGIN CERTIFICATE-----
AABBCCDDEEFF...
-----END CERTIFICATE-----
</ca>
<cert>
-----BEGIN CERTIFICATE-----
AABBCCDDEEFF...
-----END CERTIFICATE-----
</cert>
<key>
-----BEGIN PRIVATE KEY-----
AABBCCDDEEFF...
-----END PRIVATE KEY-----
</key>
<tls-crypt>
-----BEGIN OpenVPN Static key V1-----
AABBCCDDEEFF...
-----END OpenVPN Static key V1-----
</tls-crypt>
```

Delete the `<cert>` and `<key>` parts and insert an `auth-user-pass` before `<ca>`.
Example OpenVPN client profile after edit:
```conf
client
dev tun
proto udp
remote 11.22.33.44 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth SHA512
cipher AES-256-CBC
ignore-unknown-option block-outside-dns
block-outside-dns
verb 3
auth-user-pass
<ca>
-----BEGIN CERTIFICATE-----
AABBCCDDEEFF...
-----END CERTIFICATE-----
</ca>
<tls-crypt>
-----BEGIN OpenVPN Static key V1-----
AABBCCDDEEFF...
-----END OpenVPN Static key V1-----
</tls-crypt>
```

## Prepare VPN Client
Open and edit `config.json` inside the client files:
```json
{
	"authservices" : [
		{
			"id" : "google-oidc",
			"name" : "Login with Google",
			"description" : "Authenticate using your Google account",
			"wellknown" : "https://accounts.google.com/.well-known/openid-configuration",
			"clientid" : "<client-id>",
			"redirect" : "https://vpnapp.electron.gramthanos.com/oidc",
			"profile" : "unipi-oidc.ovpn"
		},
		{
			"id" : "keycloak-oidc",
			"name" : "Login with Keycloak",
			"description" : "Authenticate using your Keycloak account",
			"wellknown" : "https://keycloak.gramthanos.com:8443/auth/realms/DEMOAPP/.well-known/openid-configuration",
			"clientid" : "vpn-app-auth",
			"redirect" : "https://vpnapp.electron.gramthanos.com/oidc",
			"profile" : "unipi-oidc.ovpn"
		}
	]
}
```
Add as many services as you like.
You should register `https://vpnapp.electron.gramthanos.com/oidc` as a vali redirect URL to your Open ID Connect service.
You can point each service to a different profile or to the same profile.
You can add each profile's ovpn file inside the `profiles` folder.
As a profile ovpn file you can use the client profile we prepared during the server setup.

The client implementation need the [OpenVPN Community Client](https://openvpn.net/community-downloads/) install on your system, located either at `C:/Program Files/OpenVPN/bin/openvpn.exe` or `C:/Program Files (x86)/OpenVPN/bin/openvpn.exe`.


## Development

### Disable SSL Warnings 
If you need to disable SSL certificate warnings and errors, uncomment the appropriate files at `client/index.js`, `client/app/preload.js` and `server/auth.py`.

### Development
Enter `client` folder.

Install dependancies
```console
npm install
```

Run client application
```console
npm run start
```

Pack application for x32
```console
npm run pack:win32
```

Pack application for x64
```console
npm run pack:win64
```
