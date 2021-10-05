#!/usr/bin/env python3
import os
import sys
import json
import base64
import requests

ssl_verify = True

# TODO: This is only for development
#requests.packages.urllib3.disable_warnings()
#ssl_verify = False

authservices = {
        "google-oidc" : {
                "wellknown" : "https://accounts.google.com/.well-known/openid-configuration",
                "clientid" : "<google-client-id>",
                "secret" : "<google-secret>",
                "redirect" : "https://vpnapp.electron.gramthanos.com/oidc"
        },
        "keycloak-oidc" : {
                "wellknown" : "https://keycloak.gramthanos.com:8443/auth/realms/DEMOAPP/.well-known/openid-configuration",
                "clientid" : "<keycloak-client-id>",
                "secret" : "<keycloak-secret>",
                "redirect" : "https://vpnapp.electron.gramthanos.com/oidc"
        }
};

# Parse authen info given
authentication = json.loads(base64.b64decode(os.getenv('password')).decode())

# Check if correct response
if not 'service' in authentication.keys() or not 'code' in authentication.keys():
        sys.exit(1)
# Check if service in list of services
if not authentication['service'] in authservices.keys():
        sys.exit(1)

# Get service info
service = authservices[authentication['service']]

# Get configuration
response = requests.get(service['wellknown'], verify = ssl_verify);
# Check if request failed
if response.status_code != 200:
        sys.exit(1)
# Parse data
discovery = response.json()
# Check if endpoints dont exists
if not 'token_endpoint' in discovery.keys() or not 'userinfo_endpoint' in discovery.keys():
        sys.exit(1)

# Request data
response = requests.post(discovery['token_endpoint'], data = {
        'code': authentication['code'],
        'client_id' : service['clientid'],
        'client_secret' : service['secret'],
        'redirect_uri' : service['redirect'],
        'grant_type' : 'authorization_code'
}, verify = ssl_verify);
# Check if request failed
if response.status_code != 200:
        sys.exit(1)
# Parse data
data = response.json()
# Check if endpoints dont exists
if not 'access_token' in data.keys() or not 'id_token' in data.keys():
        sys.exit(1)

jwt = data['id_token'].split('.')
info = json.loads(base64.b64decode(jwt[1] + '=' * (-len(jwt[1]) % 4)).decode())
print('Welcome ' + info['email'] + ' !')
sys.exit(0)
