// preload.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const isDevelopment = false;
const axios = isDevelopment ? 
	require('axios').create({httpsAgent: new require('https').Agent({rejectUnauthorized: false}), adapter: require('axios/lib/adapters/http')}) :
	require('axios').create({adapter: require('axios/lib/adapters/http')});
const child_process = require('child_process');

const $app = {
	connected : false,

	configPath : path.join(__dirname, '..', 'config.json'),
	openvpnPath : null,

	// Load configuration file
	loadConfig : function() {
		// Default config
		this.config = {authservices: []};

		try {
			// Load config file
			let tmp = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
			// Validate config
			if (!tmp.hasOwnProperty('authservices') || !(tmp.authservices instanceof Array)) {
				throw('Invalid config.');
			}
			// Config loaded
			this.config = tmp;
			this.log('Config loaded.');
		} catch (e) {
			this.log('Failed to loaded config:\n' + e.toString());
		}
	},

	// Display available authentication services
	showAuthServices : function() {
		// UI wrapper for services
		const wrapper = document.getElementById('connect-form');

		// If no services available
		if (this.config.authservices.length == 0) {
			let msg = document.createElement('span');
			msg.textContent = 'No service found.';
			wrapper.appendChild(msg);
			this.log('No services available.');
			return;
		}

		let length = 0;
		// Display each service on screen
		this.config.authservices.forEach(auth => {
			let button = document.createElement('input');
			button.setAttribute('type', 'submit');
			button.setAttribute('value', auth.name);
			button.setAttribute('title', auth.description);
			button.className = 'btn btn-primary';
			button.dataset.authservice = (length + 1);
			wrapper.appendChild(button);
			length++;
		});
		this.log(length + ' services available.');
	},

	// Disable all authentication services buttons
	disableAuthServices : function() {
		[...document.getElementById('connect-form').getElementsByTagName('input')].forEach(input => {
			input.setAttribute('disabled', 'disabled');
		});
	},

	// Enable all authentication services buttons
	enableAuthServices : function() {
		[...document.getElementById('connect-form').getElementsByTagName('input')].forEach(input => {
			input.removeAttribute('disabled', 'disabled');
		});
	},

	// Change View
	enableConnectedView : function() {
		document.getElementById('disconnected').style.display = 'none';
		document.getElementById('connected').style.display = 'block';
	},
	enableDisconnectedView : function() {
		document.getElementById('connected').style.display = 'none';
		document.getElementById('disconnected').style.display = 'block';
	},

	// Add authentication services buttons handlers
	addAuthServicesEventListeners : function() {
		// Handle form submit event
		document.getElementById('connect-form').addEventListener('submit', (e) => {
			e.preventDefault();

			// Get authentication service to use (detect which button was pressed)
			const authservice = this.config.authservices[Math.round(parseInt(document.activeElement.dataset.authservice, 10)) - 1];
			if (!authservice) return false;

			// Disable authentication services buttons
			this.disableAuthServices();
			// Get authentication services information
			this.getAuthServiceEndpoint(authservice)
			.then((endpoint) => {
				// Start authentication
				this.launchAuthService(authservice, endpoint)
				.then((authentucationResponse) => {
					// Generate username and password
					let username = crypto.randomBytes(16).toString('base64') + '@' + authservice.id; // Random Username
					let password = Buffer.from(JSON.stringify(authentucationResponse)).toString('base64'); // Save auth response json as password

					// Connect on VPN
					this.vpnConnect(authservice, username, password).catch((error) => {
						this.enableAuthServices();
					});
				})
				.catch((error) => {
					reject('Failed authenticate.');
					this.enableAuthServices();
				});
			})
			.catch((error) => {
				this.log(error);
				this.enableAuthServices();
			})
			
			return false;
		});

		// Handle disconnect
		document.getElementById('disconnect-form').addEventListener('submit', (e) => {
			if (!this.openvpnProcess) {
				this.openvpnProcess.kill('SIGINT');
			}
			this.killOpenVPNClients();
		});
	},

	// Load authentication service endpoint
	getAuthServiceEndpoint : function(authservice) {
		// Load authentication service OIDC info
		this.log('Loading "' + authservice.name + '" connection information...' );
		return new Promise((resolve, reject) => {
			axios({
				method: 'get',
				url: authservice.wellknown,
				responseType: 'json'
			})
			.then((response) => {
				// Check for errors
				if (!response.data || !response.data.authorization_endpoint || !response.data.userinfo_endpoint) {
					reject('Failed to recover OIDC endpoints');
					return;
				}
				if (!response.data.response_types_supported || !response.data.response_types_supported.includes('code')) {
					reject('OIDC configuration does not support code response type');
					return;
				}
				if (!response.data.scopes_supported || !response.data.scopes_supported.includes('openid') || !response.data.scopes_supported.includes('email')) {
					reject('OIDC configuration does not support needed scopes');
					return;
				}

				resolve(response.data.authorization_endpoint);
			})
			.catch((error) => {
				reject('Failed to load OIDC configuration');
			});
		});
	},


	launchAuthService : function(authservice, endpoint) {
		this.log('Starting authentication with "' + authservice.name + '"...' );
		return new Promise((resolve, reject) => {
			let state = 'security_token' + ':' + crypto.randomBytes(64).toString('base64') + ':' + authservice.redirect;
			let nonce = crypto.randomBytes(64).toString('base64');

			// Prepare URL
			let serviceURL = new URL(endpoint);
			serviceURL.searchParams.append('client_id', authservice.clientid);
			serviceURL.searchParams.append('response_type', 'code');
			serviceURL.searchParams.append('scope', 'openid email');
			serviceURL.searchParams.append('redirect_uri', authservice.redirect);
			serviceURL.searchParams.append('state', state);
			serviceURL.searchParams.append('nonce', nonce);
			serviceURL = serviceURL.toString();
			
			// Open new window for authentication
			const { remote } = require('electron');
			const win = new remote.BrowserWindow({
				title: 'Authenticate',
				show: false,
				width: 800,
				height: 600,
				backgroundColor: '#ccc',
				webPreferences: {
					nodeIntegration: false,
					enableRemoteModule: false,
					sandbox: true
				},
				parent: remote.getCurrentWindow(),
				modal: true
			});
			//win.setMenuBarVisibility(false);

			win.once('ready-to-show', () => {
				win.show();
			});

			win.once('closed', () => {
				reject('Authentication aborted.');
			});

			win.loadURL(serviceURL);
			const {session: {webRequest}} = win.webContents;

			// Catch callback URL
			webRequest.onBeforeRequest({urls: [authservice.redirect + '*']}, (details, callback) => {
				let url = new URL(details.url);
				// Validate response state
				if (url.searchParams.get('state') !== state) {
					reject('Authentication failed, invalid response.');
					return;
				}

				// Prepare response
				let response = {
					service : authservice.id,
					//session_state : url.searchParams.get('session_state'),
					code : url.searchParams.get('code')
				};
				win.close();

				// Return authentication results
				resolve(response);
			});
		});
	},

	findOpenvpn : function() {
		// List of possible locations for openvpn
		let possiblePaths = [
			path.join('C:/Program Files', 'OpenVPN/bin', 'openvpn.exe'),
			path.join('C:/Program Files (x86)', 'OpenVPN/bin', 'openvpn.exe'),
		];

		// Check paths for openvpn
		for (let path of possiblePaths) {
			try {
				if (fs.existsSync(path)) {
					this.openvpnPath = path;
					break;
				}
			} catch(err) {}
		}
		
		// If openvpn was found
		if (this.openvpnPath) {
			try {
				// Try to load version
				let version = child_process.execFileSync(path.basename(this.openvpnPath), ['--version'], {cwd: path.dirname(this.openvpnPath)}).toString().trim();
				version = version.match(/OpenVPN\s*(\d*\.*\d*\.*\d*\.*\d*)/i);
				version = version[1] || 'Unknown';
				this.versionsInfo.push('OpenVPN' + ' ' + version);

				this.log('Found OpenVPN version ' + version);
			} catch (e) {
				// Failed to load version
				this.openvpnPath = null;
				this.log('No OpenVPN installation found.');
			}
		}
	},

	vpnConnect : function(authservice, user, pass) {
		return new Promise((resolve, reject) => {
			// Run OpenVPN Client
			this.runOpenVPNClient(authservice, (line, process) => {
				// Handle output
				if ((/Enter Auth Username:/i).test(line)) {
					process.stdin.write(user);
					return;
				}
				else if ((/Enter Auth Password:/i).test(line)) {
					process.stdin.write(pass);
					return;
				}
				else if ((/Initialization Sequence Completed/i).test(line)) {
					this.enableConnectedView();
				}
				
				//2021-09-12 21:18:53
				line = line.replace(/^\s*\d\d\d\d-\d\d-\d\d\s*\d\d:\d\d:\d\d\s*/i, '');
				this.log('[OpenVPN] ' + line);
			})
			.catch((error) => {
				this.enableDisconnectedView();
				reject();
			});
		});
	},

	runOpenVPNClient : function(authservice, handler) {
		return new Promise((resolve, reject) => {
			// Check if OpenVPN was found
			if (!this.openvpnPath) {
				reject('OpenVPN was not found.');
				return;
			}

			this.killOpenVPNClients();

			// Note
			this.log('Running OpenVPN Client.');

			// Create OpenVPN process
			var child = child_process.spawn(path.basename(this.openvpnPath), [
				'--config',
				path.join(__dirname, '..', 'profiles', authservice.profile)
			], {
				encoding: 'utf8',
				shell: true,
				cwd: path.dirname(this.openvpnPath)
			});

			// You can also use a variable to save the output for when the script closes later
			child.on('error', (error) => {
				console.log('OpenVPN Client Error', error.toString());
			});

			child.stdin.setEncoding('utf8');

			child.stdout.setEncoding('utf8');
			child.stdout.on('data', (data) => {
				handler(data.toString(), child);
			});

			child.stderr.setEncoding('utf8');
			child.stderr.on('data', (data) => {
				handler(data.toString(), child);
			});

			child.on('close', (code) => {
				// Here you can get the exit code of the script  
				//switch (code) {
				//	case 0:
				//		console.log('Client Close', 'Ended');
				//		break;
				//}
				reject(code);
			});

			this.openvpnProcess = child;
		});
	},

	killOpenVPNClients : function() {
		try {
			child_process.execFileSync('taskkill.exe', ['/F', '/IM', 'openvpn.exe']);
		} catch (e) {}
	},

	// Load node info
	versionsInfo : [],
	loadVersionsNode : function() {
		const capitalize = (word) => {return word[0].toUpperCase() + word.substring(1).toLowerCase();}
		// List versions
		for (let dependency of ['chrome', 'node', 'electron']) {
			this.versionsInfo.push(capitalize(dependency) + ' ' + process.versions[dependency]);
		}
	},

	// Show versions on GUI
	showVersions : function() {
		// Clear placeholder
		document.getElementById('version').textContent = '';
		// List versions
		for (let version of this.versionsInfo) {
			document.getElementById('version').appendChild(document.createTextNode(version));
			document.getElementById('version').appendChild(document.createElement('br'));
		}
	},

	// Log information function
	log : function(data, date=true, newline=true) {
		if (!this.logElement) {
			this.logElement = document.getElementById('log-textarea');
		}
		this.logElement.value += (newline ? '\n' : '') + (date ? '[' + new Date().toISOString() + '] ' : '') + data;
	}
};

// When DOM is ready
window.addEventListener('DOMContentLoaded', () => {
	// Log app start
	$app.log('Client started.', true, false);
	// Load some version info
	$app.loadVersionsNode();
	// Find OpenVPN installation
	$app.findOpenvpn();
	// Load app configuration file
	$app.loadConfig();
	// Display available authentication services
	$app.showAuthServices();
	// Attach handlers
	$app.addAuthServicesEventListeners();
	// Show versions on GUI
	$app.showVersions();
});
