/* Original Author: Brendan Flynn & Rob Chambers!
 * 
 * Stand-alone factory to handle all FlexVolt communications
 * 
 * Provides methods (such as getData) which can be called regularly to get data
 * 
 * ex:  
 *      function updateAnimate(){
 *          var data = getData();
 *          do animation stuff with the new data
 *      }
 * 
 *      function animateStep(){
 *          afID = window.requestAnimationFrame(paintStep);
 *          updateAnimate();
 *      }
 *      
 *      animateStep();
 * 
 * The above example calls getData evert frame (typically 60 FPS)
 * 
 */

(function () {
'use strict';
    
angular.module('flexvolt.flexvolt', [])

/**
 * Abstracts the flexvolt, deals with bluetooth communications, etc.
 */
.factory('flexvolt', ['$q', '$timeout', '$interval', 'bluetoothPlugin', 'hardwareLogic', 
  function($q, $timeout, $interval, bluetoothPlugin, hardwareLogic) {
    window.q = $q;
    var connectionTestInterval;
    var receivedData;
    var defaultWait = 1000;
    var modelList = [];
    var dots = '';
    modelList[0] = 'USB 2 Channel';
    modelList[1] = 'USB 4 Channel';
    modelList[2] = 'USB 8 Channel';
    modelList[3] = 'Bluetooth 2 Channel';
    modelList[4] = 'Bluetooth 4 Channel';
    modelList[5] = 'Bluetooth 8 Channel';
    
    // flag to make sure we don't end up with multipe async read calls at once!
    var checkingForData = false;
    var dIn = [], dataParsed = [];

    var pollingTimeout,
      DISCOVER_DELAY_MS = 500;
    
    //promise bucket
    var deferred = {};
    
    var FREQUENCY_LIST = [1, 10, 50, 100, 200, 300, 400, 500, 1000, 1500, 2000];
    
    // api... contains the API that will be exposed via the 'flexvolt' service.
    var api = {
        disconnect: undefined,
        updatePorts: undefined,
        turnDataOn: undefined,
        turnDataOff: undefined,
        updateSettings: undefined,
        pollVersion: undefined,
        getDataParsed: undefined,
        portList: [],
        preferredPortList: [],
        flexvoltPortList: [],
        tryList: undefined,
        currentPort: undefined,
        connection: {
            version: undefined,
            serialNumber: undefined,
            modelNumber: undefined,
            model: undefined,
            state: undefined,
            data: undefined,
            dataOnRequested: undefined,
            flexvoltName: undefined
        },
        settings: {
            frequencyCustom : 0,
            timer0PartialCount : 0,
            timer0AdjustVal : 2,
            prescalerPic : 2,
            downSampleCount : 0,
            plugTestDelay : 0
        },
        readParams : {
            expectedChar : undefined,
            expectedBytes: undefined,
            offset: undefined
        }
    };
    
    ionic.Platform.ready(function(){
        
        bluetoothPlugin.subscribe(function(data){
            var bytes = new Uint8Array(data);
            onDataReceived(bytes);
        },function(e){
            console.log('error in subscribe');
            console.log(e);
            if (e.error === 'device_lost'){
                connectionErr('connection lost');
            }
        });

        function init(){
            api.connection.state = 'begin';
            api.connection.data = 'off';
            api.connection.dataOnRequested = false;
            
            // TODO grab settings from local file
            api.settings.frequencyCustom = 0;
            api.settings.timer0PartialCount = 0;
            api.settings.timer0AdjustVal = 2;
            api.settings.prescalerPic = 2;
            api.settings.downSampleCount = 0;
            api.settings.plugTestDelay = 0;
        }

        function cancelTimeout() {
            if ( pollingTimeout ) {
                $timeout.cancel(pollingTimeout);
                pollingTimeout = undefined;
            }
        }
        
        api.cancelConnection = function() {
          cancelTimeout();
          for (var p in deferred){
            deferred[p].reject('Connection Attempt Cancelled');
            delete deferred[p];
          }
          api.disconnect();
        };

        // Connection Code.
        function simpleLog(msg) { console.log(msg); }
        
        function connectedCB(){
            console.log('DEBUG: connectedCB');
            turnDataOn();
        }
        function notConnectedCB(){
            console.log('DEBUG: notConnectedCB');
            api.resetConnection();
        }
        
        // the interval connection check call
        function checkConnection(){
            if (api.connection.state === 'connected' && !api.connection.data === 'on'){
                console.log('DEBUG: Connected NOT taking data');
                // if data off, just handshake.  If the handshake fails (connectionErr, expected return chars not received
//                testHandshake(function(){
//                    //console.log('DEBUG: testHandshake worked');
//                });
            } else if(api.connection.state === 'connected' && api.connection.data === 'on') {
                //console.log('DEBUG: Connected and taking data');
                if (receivedData){
                    //connection still good.  reset flag
                    receivedData = false;
                } else {
                    // was data turned off?
                    console.log('ERROR: Stopped getting data.');
                    // check connection
                    bluetoothPlugin.isConnected(connectedCB, notConnectedCB, connectionErr);
                }
            }
        }
        
        // Async event listener function to pass to subscribe/addListener
        function onDataReceived(d){
            receivedData = true;
            var tmpL = dIn.length;
            for (var i = 0; i < d.length; i++){
                dIn[tmpL+i] = d[i];
            }
        }
        
        // Send a command, wait for nBytes, check received bytes against inMsg, call nextFunc!
        function waitForInput(outMsg, waitTime, inMsg, nextFunc){
            if (outMsg !== null){
                //console.log('OUTPUT: '+outMsg);
                write(outMsg);
            }
            
            // wait for data to come back
            pollingTimeout = $timeout(function(){
                while(dIn.length > 0){
                    //console.log('dIn.length = '+dIn.length);
                    var b = dIn.slice(0,1);
                    dIn = dIn.slice(1);
                    if (api.connection.data !== 'turningOff'){
                        console.log('INPUT: '+b+', exp: '+inMsg+', n = '+dIn.length);
                    }
                    if (b[0] === inMsg){
                        //console.log('msg found');
                        nextFunc();
                        return;
                    }
                }
                connectionErr('Expected '+inMsg);
            },waitTime);
        }
        
        function connectionErr(e) {
            console.log('DEBUG: connectionErr: '+JSON.stringify(e));
            $interval.cancel(connectionTestInterval);
            api.connection.data = 'off';
            api.connection.dataOnRequested = false;
            if (api.connection.state === 'searching'){
                console.log('DEBUG: Testing next port');
                bluetoothPlugin.disconnect(tryPorts,simpleLog);
            } else if (api.connection.state === 'connecting'){
                console.log('WARNING: Connection error.  Awaiting input.');
                api.connection.state = 'begin';
                //$timeout(api.discoverFlexVolts, DISCOVER_DELAY_MS);  // infinite loop!
            } else if (api.connection.state === 'connected'){
                console.log('WARNING: Connection lost!');
                connectionResetHandler(api.discoverFlexVolts);
            } else {
                console.log('WARNING: Connection dropped!  State: '+api.connection.state);
                connectionResetHandler(api.discoverFlexVolts);
            }
        }
        function connectionResetHandler(cb){
            console.log('DEBUG: connectionResetHandler');
            $interval.cancel(connectionTestInterval);
            api.connection.state = 'disconnected'; 
            api.connection.data = 'off';
            bluetoothPlugin.disconnect(
                function () { 
                    if (cb){
                        console.log('DEBUG: Reseting Connection.');
                        $timeout(cb,250);
                    } else {
                        api.connection.state ='begin';
                        bluetoothPlugin.clear(function() {
                          console.log('DEBUG: Cleared Connection');
                        }, function() {
                          console.log('Error clearing bluetooth');
                        });
                        
                    }
                },
                function () { console.log('Error disconnecting.'); 
            });
        }
        api.resetConnection = function(cb){  // pass true to reconnect
            console.log('DEBUG: resetConnection, state:'+api.connection.state);
            if (api.connection.state === 'connecting' || api.connection.state === 'searching'){
                console.log('INFO: connection attempt already in progress');
                return;
            }
            api.updatePorts();
            $timeout(function(){
                connectionResetHandler(api.discoverFlexVolts);
            },250);
        };
        api.disconnect = function(){
            write('X');
            console.log('DEBUG: disconnection');
            connectionResetHandler(false);
        };
        function convertPortList(btDeviceList){
            var portList = [];
            btDeviceList.forEach(function(device){
                if (window.flexvoltPlatform === 'cordova'){
                    portList.push(device.id);
                } else if (window.flexvoltPlatform === 'chrome'){
                    portList.push(device.path);
                }
            });
            api.portList = portList;
        }
        api.updatePorts = function() {
            console.log('updating portlist');
            bluetoothPlugin.list(convertPortList,simpleLog);
        };
        api.discoverFlexVolts = function() {
            deferred.discover = $q.defer();
            console.log('Listing devices...');
            api.connection.state = 'searching';
            bluetoothPlugin.list(handleBTDeviceList, connectionErr);
            
            return deferred.discover.promise;
            
            function handleBTDeviceList ( deviceList ) {
                if (deferred.discover) {
                    // only run this logic IF the process has not been cancelled
                    console.log('Got device list:');

                    // convert to an array of portName strings
                    convertPortList(deviceList);
                    console.log(JSON.stringify(api.portList));
                    api.preferredPortList = [];
                    api.flexvoltPortList = [];

                    // look for meaningful names
                    api.portList.forEach(function(portName) { 
                        if ( portName.indexOf('FlexVolt') > -1 ) {
                            api.preferredPortList.push(portName);
                        }
                    });

                    // move preferred ports to the front
                    if (api.preferredPortList.length > 0){
                        console.log('Preferred port list:'+JSON.stringify(api.preferredPortList));
                        for (var i = 0; i < api.preferredPortList.length; i++){
                            api.portList.splice(api.portList.indexOf(api.preferredPortList[i]),1);
                            api.portList.push(api.portList.length,0,api.preferredPortList[i]);
                        }
                        console.log('Updated portList: '+JSON.stringify(api.portList));
                    } else {console.log('No preferred ports found');}

                    // make tmp portlist 
                    api.tryList = api.portList.slice(0); // clean copy
                    
                    deferred.discover.resolve();
                }
            }
        };
        function tryPorts(){
            console.log('DEBUG: in tryPorts');
            
            
            //console.log(api.tryList);
            // the tryList is a copy of the ports list.  Try each port, then remove it from the list
            // if it's a flexvolt, add that port to flexvoltPortList
            // once the tryList is empty, if we found a flexvolt connect.  Otherwise, error out, go back to begin
            if (api.tryList.length > 0){
                api.currentPort = api.tryList.pop();
                api.connection.state = 'searching';
                attemptToConnect(api.currentPort);
            } else {
                console.log('No FlexVolts found!');
                //didn't find anything?!
                api.connection.state = 'no flexvolts found';
            }
        }
        api.manualConnect = function(portName){
            console.log('DEBUG: Manual connect '+portName);
            connectionResetHandler(function(){
                api.connection.state = 'connecting';
                api.currentPort = portName;
                attemptToConnect(portName);
            });
        };
        function attemptToConnect ( portName ) {
            console.log('DEBUG: Trying device: ' + portName);
            bluetoothPlugin.connect(portName, connectSuccess, connectionErr);
        }
        function connectSuccess() {
            console.log('DEBUG: Now connected to a port');
            write('X');
            bluetoothPlugin.clear(handshake1, simpleLog);
        }
        function handshake1() {
            pollingTimeout = $timeout(function(){
                waitForInput('A',defaultWait,97,handshake2);
            },2000);   
        }
        function handshake2(){
            console.log('DEBUG: Received "a", writing "1".  (FlexVolt found!)');
            waitForInput('1',defaultWait,98,handshake3);
        }
        function handshake3(){
            console.log('DEBUG: Received "b", handshake complete.');
            api.flexvoltPortList.push(api.currentPort);
            api.connection.flexvoltName = api.currentPort;
            api.connection.state = 'connected';
            connectionTestInterval = $interval(checkConnection,1000);
            console.log('Connected to ' + api.currentPort);
            api.pollVersion()
               .then(api.updateSettings)
               .catch(function(err){console.log('poll/update caught with msg: '+err);});
        }
        function testHandshake(cb){
            waitForInput('Q',defaultWait,113,cb);
        }
        api.pollVersion = function(){
            deferred.polling = $q.defer();
            api.connection.state = 'polling';
            bluetoothPlugin.clear(
                function () { 
                    waitForInput('V',defaultWait,118,parseVersion);
                },
                function(){console.log('Error clearing in pollVersion');}
            );
            return deferred.polling.promise;
            
            function parseVersion(){
                if (deferred.polling) {
                    if (dIn.length >= 4){
                        api.connection.state = 'connected';
                        var data = dIn.slice(0,4);
                        api.connection.version = Number(data[0]);
                        api.connection.serialNumber = Number((data[1]*(2^8))+data[2]);
                        api.connection.modelNumber = Number(data[3]);
                        api.connection.model = modelList[api.connection.modelNumber];
                        console.log('Version = '+api.connection.version+'. SerialNumber = '+api.connection.serialNumber+'. MODEL = '+api.connection.model+', from model# '+api.connection.modelNumber);
                        dIn = dIn.slice(4);
                        deferred.polling.resolve();
                    } else {
                        pollingTimeout = $timeout(parseVersion);
                    }
                }
            }
        };
        api.updateSettings = function(){
            deferred.updateSettings = $q.defer();
            if (api.connection.state === 'connected'){
                console.log('Updating Settings');
                api.connection.state = 'updating settings';
                waitForInput('S',defaultWait,115,updateSettings2);
            } else {
                console.log('Cannot Update Settings - not connected');
            }
            
            return deferred.updateSettings.promise;
            
            function updateSettings2(){
                if (deferred.updateSettings) {
                    console.log('Update Settings 2');
                    var REG = [];
                    var REGtmp = 0;
                    var tmp = 0;

                    //Register 1
                    if (hardwareLogic.settings.nChannels === 8)tmp = 3;
                    if (hardwareLogic.settings.nChannels === 4)tmp = 2;
                    if (hardwareLogic.settings.nChannels === 2)tmp = 1;
                    if (hardwareLogic.settings.nChannels === 1)tmp = 0;
                    REGtmp = tmp << 6;

                    var frequencyIndex = FREQUENCY_LIST.indexOf(hardwareLogic.settings.frequency);
                    REGtmp += frequencyIndex << 2;
                    tmp = 0;
                    if (hardwareLogic.settings.smoothFilterFlag) {
                        tmp = 1;
                    }
                    REGtmp += tmp << 1;
                    tmp = 0;
                    if (hardwareLogic.settings.bitDepth10) {
                        tmp = 1;
                    }
                    REGtmp += tmp;
                    REG.push(REGtmp); // 11110100 (252)

                    REGtmp = 0;
                    REGtmp += api.settings.prescalerPic << 5;
                    REGtmp += hardwareLogic.settings.smoothFilterVal;
                    REG.push(REGtmp); // 01001000 72

                    REGtmp = api.settings.frequencyCustom;
                    REGtmp = (Math.round(REGtmp >> 8)<<8);
                    REGtmp = api.settings.frequencyCustom-REGtmp;
                    REG.push(REGtmp); // 00000000

                    REGtmp = api.settings.frequencyCustom>>8;
                    REG.push(REGtmp); // 00000000

                    REGtmp = api.settings.timer0AdjustVal+6;
                    REG.push(REGtmp); // 00001000 8

                    REGtmp = api.settings.timer0PartialCount;
                    REGtmp = (Math.round(REGtmp >> 8)<<8);
                    REGtmp = api.settings.timer0PartialCount-REGtmp;
                    REG.push(REGtmp); // 00000000

                    REGtmp = api.settings.timer0PartialCount>>8;
                    REG.push(REGtmp); // 00000000

                    REGtmp = api.settings.downSampleCount;
                    REG.push(REGtmp); // 00000001 1

                    REGtmp = api.settings.plugTestDelay;
                    REG.push(REGtmp);

                    console.log('REG.length='+REG.length);
                    var msg = '';
                    for (var i = 0; i < REG.length; i++){
                        msg += REG[i]+', ';
                    }
                    console.log('REG='+msg+'bytes/ ='+REG.BYTES_PER_ELEMENT);

                    writeBuffer(REG);
                    waitForInput(null,10*defaultWait,121,updateSettings3);  
                }
            }
            function updateSettings3(){
                if (deferred.updateSettings) {
                    console.log('Update Settings 3');
                    waitForInput('Y',defaultWait,122,updateDataSettings);
                }
            }
            function updateDataSettings(){
                if (deferred.updateSettings) {
                    api.connection.state = 'connected';
                    /* settings read parameters
                     * 67'C' = 8 bits, 1ch, 2 Bytes
                     * 68'D' = 8 bits, 2ch, 3 Bytes
                     * 69'E' = 8 bits, 4ch, 5 Bytes
                     * 70'F' = 8 bits, 8ch, 9 Bytes
                     *  don't use 10-bit!  the bottom 2 bits of most ADCs are noise anyway!
                     * 72'H' = 10bits, 1ch, 3 Bytes
                     * 73'I' = 10bits, 2ch, 4 Bytes
                     * 74'J' = 10bits, 4ch, 6 Bytes
                     * 75'K' = 10bits, 8ch, 11 Bytes
                     */

                    if (!hardwareLogic.settings.bitDepth10){
                        api.readParams.offset = 128;
                        if (hardwareLogic.settings.nChannels === 1){
                            api.readParams.expectedChar = 67;
                            api.readParams.expectedBytes = 2;
                        } else if (hardwareLogic.settings.nChannels === 2){
                            api.readParams.expectedChar = 68;
                            api.readParams.expectedBytes = 3;
                        } else if (hardwareLogic.settings.nChannels === 4){
                            api.readParams.expectedChar = 69;
                            api.readParams.expectedBytes = 5;
                        } else if (hardwareLogic.settings.nChannels === 8){
                            api.readParams.expectedChar = 70;
                            api.readParams.expectedBytes = 9;
                        }
                    } else if (hardwareLogic.settings.bitDepth10){
                        api.readParams.offset = 512;
                        if (hardwareLogic.settings.nChannels === 1){
                            api.readParams.expectedChar = 72;
                            api.readParams.expectedBytes = 3;
                        } else if (hardwareLogic.settings.nChannels === 2){
                            api.readParams.expectedChar = 73;
                            api.readParams.expectedBytes = 4;
                        } else if (hardwareLogic.settings.nChannels === 4){
                            api.readParams.expectedChar = 74;
                            api.readParams.expectedBytes = 6;
                        } else if (hardwareLogic.settings.nChannels === 8){
                            api.readParams.expectedChar = 75;
                            api.readParams.expectedBytes = 11;
                        }
                    }
                    console.log('INFO: Updated settings, read params: '+JSON.stringify(api.readParams));
                    if (api.connection.dataOnRequested){
                        console.log('DEBUG: dataOnRequested');
                        turnDataOn();
                    }
                }
            }
        };
        
        function turnDataOn(){
            console.log('DEBUG: turning data on');
            
            if (api.connection.state === 'connected'){
                api.connection.data = 'turningOn';
                bluetoothPlugin.clear(
                    function () { 
                        console.log('DEBUG: Cleared in turnDataOn.'); 
                        waitForInput('G',defaultWait,103,function(){
                            console.log('Turned data on');
                            api.connection.data = 'on';
                        });
                    },
                    function(msg){
                        api.connection.data = 'off';
                        console.log('ERROR: in clear in turnDataOn');
                        console.log(msg);
                    }
                );
            } else if (api.connection.state === 'update settings' || api.connection.state === 'polling' || api.connection.state === 'connecting'){
                console.log('DEBUG: fail - still initializing');
                api.connection.data = 'off';
            } else {
                console.log('WARNING: fail - not connected');
                api.connection.data = 'off';
            }
        }
        function turnDataOff(){ // 113 = 'q'
            console.log('DEBUG: turning data off');
            if (api.connection.data === 'on'){
                api.connection.data = 'turningOff';
                dIn = [];
                waitForInput('Q',2*defaultWait,113,function(){
                    console.log('DEBUG: data off.');
                    api.connection.data = 'off';
                });
            }  else {console.log('DEBUG: data not on');}
        }
        api.getDataParsed = function(){
            var dataParsed = [];
            if (!checkingForData && api.connection.state === 'connected' && api.connection.data === 'on'){
                checkingForData = true;
                var dataIn = dIn.slice(0);
                if (dataIn.length >= api.readParams.expectedBytes){
                    // initialize parsed data vector
                    dataParsed = new Array(hardwareLogic.settings.nChannels);
                    for (var i = 0; i < hardwareLogic.settings.nChannels; i++){ dataParsed[i]=[]; }
                    // Parse channels
                    var readInd = 0, dataInd = 0;
                    while(readInd < (dataIn.length-api.readParams.expectedBytes) ){
                        var tmp = dataIn[readInd++];
                        if (tmp === api.readParams.expectedChar){
                            if (!hardwareLogic.settings.bitDepth10) {
                                for (var i = 0; i < hardwareLogic.settings.nChannels; i++){
                                    dataParsed[i][dataInd] = dataIn[readInd++] - api.readParams.offset; // centering on 0!
                                }
                                dataInd++;
                            } else {
                                var tmpLow = dataIn[readInd+hardwareLogic.settings.nChannels];
                                for (var i = 0; i < hardwareLogic.settings.nChannels; i++){
                                    dataParsed[i][dataInd] = (dataIn[readInd++]<<2) + (tmpLow & 3) - api.readParams.offset; // centering on 0!
                                    tmpLow = tmpLow >> 2;
                                }
                                readInd++; // for the tmpLow read
                                dataInd++;
                            }
                                
                        } else {
                            console.log('got unexpected Char '+tmp);
                        }
                    }
                    // Remove read samples from the incoming data array
                    dIn = dIn.slice(readInd);
                }
                checkingForData = false;
            }
            // copy, clear, return.  REMEMBER - bluetoothPlugin is ASYNC!
            return dataParsed;
        };
        function write( data ) {
            bluetoothPlugin.write(data, function(){}, simpleLog);
        }
        function writeBuffer( data ){
            // data can be an array or Uint8Array
            var sendTimer;
            var bufInd = 0;
            var nBytes = data.length;

            function sendFunc(){
                if (bufInd < nBytes){
                    var tmpBuf = new ArrayBuffer(1);
                    var tmpView = new Uint8Array(tmpBuf);
                    tmpView[0]=data[bufInd];
                    bluetoothPlugin.write(tmpBuf, function(){}, simpleLog);
                    bufInd++;
                    if (bufInd >= nBytes){
                        $interval.cancel(sendTimer);
                    }
                }
            } 
            sendTimer = $interval(sendFunc, 50, nBytes);
        }

        init();
        
        // This starts it all!
        $timeout(startConnect, DISCOVER_DELAY_MS);
        function startConnect(){
          console.log('starting connection');
          api.discoverFlexVolts()
             .then(tryPorts)
             .catch(function(msg){
               console.log('Disconnected with msg: '+msg);
             });
        }
        
        function updateDots(){
            dots += '. ';
            if (dots.length > 12){
                dots = '';
            }
        }
        
        $interval(updateDots, 400);
              
        api.turnDataOn = function(){
            api.connection.dataOnRequested = true;
            turnDataOn();
        };
        api.turnDataOff = function(){
            api.connection.dataOnRequested = false;
            turnDataOff();
        };
    });
    return {
        api : api,
        getConnectingStatus: function(){
          return api.connection.state === 'searching' || api.connection.state === 'connecting';
        },
        getConnectionStatus: function(){
            return api.connection.state === 'connected' || api.connection.state === 'polling' || api.connection.state === 'updating settings';
        },
        getDetailedConnectionStatus: function(){
            if (api.connection.state === 'begin'){
                return 'Waiting for Input.  Tap button below to try to connect.';
            } else if (api.connection.state === 'searching'){
                return 'Scanning available ports for FlexVolts. '+dots;
            } else if (api.connection.state === 'connecting'){
                return 'Atempting to establish a connection. '+dots;
            } else if (api.connection.state === 'connected'){
                return 'Connected.';
            } else if (api.connection.state === 'polling'){
                return 'Polling Version. '+dots;
            } else if (api.connection.state === 'updating settings'){
                return 'Updating Settings. '+dots;
            } else if (api.connection.state === 'no flexvolts found'){
                return 'No FlexVolt devices found.  Is your FlexVolt powered on and paired/connected?';
            } else {return 'Info not avaiable.';}
        },
        getPortList: function(){
            return api.portList;
        },
        getPrefPortList: function(){
            return api.preferredPortList;
        }
    };
  }]);
  
  }());