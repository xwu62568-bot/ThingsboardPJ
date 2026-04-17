
import {BleManager,ConnectionPriority} from 'react-native-ble-plx';
import {Buffer} from 'buffer';
import Func from '../component/Func';
import {DeviceEventEmitter, Platform,} from 'react-native'
import Command from '../component/Command';
global.isConnected = false
global.isBleOpen = false
global.rssi = 100000 
global.isScanning=false
global.autoconnect=true
let isOnlyOne = false

module.exports = {

    /**
     * 蓝牙状态监听*/
    Init() {
        this.manager = new BleManager();
        console.log('蓝牙已初始化')
    },

    /**
     * 蓝牙搜索-----默认 8秒后 取消搜索*/
    SearchBle( successCallback, errorCallback, seconds = 8000,) {
        global.isScanning = true
        this.timer && clearTimeout(this.timer)
        console.log('开始搜索=====>>>>>')
        this.manager.startDeviceScan(null, null, (error, device) => {
            if (error) {
                // Handle error (scanning will be stopped automatically)
                    global.isScanning = false
                    errorCallback(error)
                return
            }
            // console.log('扫描到的设备===', device)
            // if (deviceName) {
                if (device.name&&device.serviceUUIDs !== null&&device.serviceUUIDs.length==3) {
                    console.log('扫描到的设备===', device.serviceUUIDs,device.id,device.rssi)
                    let sUUIDS = device.serviceUUIDs
                    // 0000dae3-0000-1000-8000-00805f9b34fb 301B972FDAE3
                    let bleMacAddress = ''
                    for(let i in sUUIDS){
                        let uuidArr = sUUIDS[i].split('-')
                        if(uuidArr.length){
                            let oneStr = uuidArr[0]
                            if(oneStr.length>4){
                                let subStr = oneStr.substring(4)
                                bleMacAddress = subStr.concat(bleMacAddress)
                            }
                        }
                    }
                    bleMacAddress = bleMacAddress.toUpperCase()
                    console.log('bleMac',bleMacAddress)

                if (global.macAddress === bleMacAddress) {
                    // Stop scanning as it's not necessary if you are scanning for one device.
                    // this.StopSearchBle()
                    successCallback(device)
                    global.isScanning = false
                    this.manager.stopDeviceScan();
                    this.timer && clearTimeout(this.timer)
                }
            } 
        });
        if(global.isBleOpen){
            this.timer = setTimeout(() => {
                console.log('扫描结束====停止扫描',)
                errorCallback('')
                global.isScanning = false
                this.manager.stopDeviceScan();
            }, seconds)
        }
    },
    readRssi(id,successCallback, errorCallback){
        this.manager.readRSSIForDevice(
             id,
            'readRssi'
        ).then((device) => {
            successCallback(device.rssi)
            console.log('readRssi success===', device)

        }).catch((err) => {
            errorCallback(err)
            console.log('readRssi fail===', err)
        })
    },

    ConnectBle(id, successCallback, errorCallback) {
        console.log(id,'ConnectBle=====================')
        if(Platform.OS === 'android' && !this.disconnectedSubscription){
            this.onDeviceDisconnected(id,successCallback,errorCallback)
        }
        if(global.isConnected){
            // alert('Only one Bluetooth can be connected ')
            errorCallback('device is already connected')
        }else{
            this.manager.connectToDevice(id,{autoConnect:false,timeout:Platform.OS === 'android' ? 15000 : 'undefined',/** connectionPriority:1**/}).then((device) => {
                console.log('connect success===', device)
                global.rssi =device.rssi
                global.isConnected = true
                global.autoconnect=true
                global.deviceId = device.id
                // 查找设备的所有服务、特征和描述符。
                this.getAllServicesAndCharacteristicsForDevice(device,() => {
                    if(Platform.OS === 'android'){
                        this.manager.requestConnectionPriorityForDevice(id,ConnectionPriority.High).then((device)=>{

                            successCallback(device)
                        })
                    }else{
                        successCallback(device)
                    }
                }, err => {
                    
                })
                if(!this.disconnectedSubscription){
                    this.onDeviceDisconnected(id,successCallback,errorCallback)
                }

                // return device.discoverAllServicesAndCharacteristics();
            })
            // .then(services => {
            //   console.log('fetchServicesAndCharacteristicsForDevice', services);
            //   this.getUUID(services)
            // })
            .catch((err) => {
                console.log('connect fail===', err)
                errorCallback(err)
            })
        }
    },
    onDeviceDisconnected(id,successCallback,errorCallback){
        //监听断开事件
        this.disconnectedSubscription = this.manager.onDeviceDisconnected(id,(error)=>{
            console.log('断开事件：',error)
            global.isConnected = false
            DeviceEventEmitter.emit('bleListener', {code:-1});
            if(global.autoconnect==true){
                this.ConnectBleWithAuto(id,successCallback,errorCallback)
            }
        })
    },
    ConnectBleWithAuto(id, successCallback, errorCallback) {
        console.log(id,'Auto ConnectBle=====================')
        if(!global.isBleOpen){
            errorCallback('device ble is turn off')
        }else if(global.isConnected){
            // alert('Only one Bluetooth can be connected ')
            errorCallback('device is already connected')
        }else{
            this.manager.connectToDevice(id,{autoConnect:false,timeout:Platform.OS === 'android' ? 8000 : 'undefined'}).then((device) => {
                console.log('connect success===', device)
                global.rssi =device.rssi
                global.isConnected = true
                global.deviceId = device.id
                // 查找设备的所有服务、特征和描述符。
                this.getAllServicesAndCharacteristicsForDevice(device,() => {
                    if(Platform.OS === 'android'){
                        this.manager.requestConnectionPriorityForDevice(id,ConnectionPriority.High).then((device)=>{

                            successCallback(device)
                        })
                    }else{
                        successCallback(device)
                    }
                }, err => {
                    
                })
                if(!this.disconnectedSubscription){
                    this.onDeviceDisconnected(id,successCallback,errorCallback)
                }
                // return device.discoverAllServicesAndCharacteristics();
            })
            // .then(services => {
            //   console.log('fetchServicesAndCharacteristicsForDevice', services);
            //   this.getUUID(services)
            // })
            .catch((err) => {
                console.log('connect fail===', err)
                errorCallback(err)
            })
        }
    },
    getAllServicesAndCharacteristicsForDevice(device,successCallback){
        this.manager
        .discoverAllServicesAndCharacteristicsForDevice(device.id)
        .then(device => {
            // this.GetServiceId(device,successCallback,errorCallback)
            this.device =device
            console.log('all available services and characteristics device: ', device)
            this.mac_id = device.id
            this.writeResponseServiceUUID = Func.bleUUID.writeWithResponseServiceUUID
            this.writeResponseCharacteristicUUID = Func.bleUUID.writeWithResponseCharacteristicUUID
            successCallback()
            this.StartNoticeBle(Func.bleUUID.nofityServiceUUID,Func.bleUUID.nofityCharacteristicUUID)
            // this.GetServiceId(device)
        })
        .catch(error => {
            console.log('get all available services and characteristics device fail : ', error);
        })
    },
    //获取蓝牙设备的服务uuid,5.0    //服务uuid可能有多个
    GetServiceId(device,successCallback,errorCallback){
        this.manager.servicesForDevice(device.id).then((data) => {
            // 为设备发现的服务id对象数组
            console.log('services list: ', data)
            // this.mac_id = device.id
            // this.nofityServiceUUIDs =''
            // this.writeResponseServiceUUID = ''
            this.GetCharacterIdNotify( this.writeResponseServiceUUID,successCallback,errorCallback)
            this.GetCharacterIdNotify( '0000180a-0000-1000-8000-00805f9b34fb',successCallback,errorCallback)
            this.GetCharacterIdNotify( '00010203-0405-0607-0809-0a0b0c0d1912',successCallback,errorCallback)

        }, err => console.log('services list fail===', err))
    },

    // 根据服务uuid获取蓝牙特征值,开始监听写入和接收
    GetCharacterIdNotify(server_uuid,successCallback,errorCallback) {
        this.manager.characteristicsForDevice(this.mac_id, server_uuid).then((data) => {
            console.log('characteristics list: ', data)
            // this.nofityCharacteristicUUID =''
            // this.writeResponseCharacteristicUUID = ''
            // this.StartNoticeBle(this.nofityServiceUUIDs,this.nofityCharacteristicUUID)
            // this.onDisconnect()
            successCallback(this.mac_id, this.nofityServiceUUIDs, this.nofityCharacteristicUUID)
        }, err => {console.log('characteristics list fail:', err);errorCallback(err)})
    },

    // 开启蓝牙监听功能
    StartNoticeBle(ServiceUUID,CharacteristicUUID) {
        console.log('开始数据接收监听', this.mac_id, ServiceUUID,CharacteristicUUID)
        this.manager.monitorCharacteristicForDevice(this.mac_id,ServiceUUID, CharacteristicUUID, (error, characteristic) => {
            if (error) {
                console.log('ble response hex data fail：', error)
            } else {
                            //   Buffer.from(value, 'base64').toString('ascii');
                let resData = Buffer.from(characteristic.value, 'base64').toString('hex')
                let buff = this.hexStringToArrayBuffer(resData)
                DeviceEventEmitter.emit('bleListener', {code:0,buff});
                // console.log('ble response hex data:', buff,this.ab2hex(buff));
                // this.responseData = resData
            }
        }, 'monitor')
    },



    //  三、 设备返回的数据接收
    BleWrite(value, successCallback, errorCallback) {
        this.responseData = ''
        this.recivetimer && clearInterval(this.recivetimer)
        if(!global.isConnected){
            // alert(' Bluetooth not connected ')
            return
        }

         //   Buffer.from(value,'ascii').toString('base64')
        // let formatValue = Buffer.from(value, 'hex').toString('base64');

        let base64 = Buffer.from(value, 'hex').toString('base64');
    
        console.log('write hex:',Command.hexToString(value))

        this.manager.writeCharacteristicWithResponseForDevice(this.mac_id, this.writeResponseServiceUUID,
            this.writeResponseCharacteristicUUID, base64, null)
            .then(characteristic => {
                console.log('write success');
                // this.recivetimer = setInterval(()=>{
                //     if(this.responseData){
                //         // console.log('while do ===',this.responseData);
                //         successCallback(this.responseData)
                //         this.recivetimer && clearInterval(this.recivetimer)
                //     }
                // },500)
            }, error => {
                console.log('write fail: ', error);
                errorCallback(error)
                // alert('write fail: ', error.reason);
            })
    },

    //只需向设备下发指令，无需接收
    BleWrite1(value, successCallback, errorCallback) {
        if(!global.isConnected){
            if(!isOnlyOne){
                isOnlyOne = true
                alert(' Bluetooth not connected ')
            }
            return
        }
        let formatValue = Buffer.from(value, 'hex').toString('base64');
        console.log('write WithoutResponse hex:',Command.hexToString(formatValue))

        this.manager.writeCharacteristicWithoutResponseForDevice(this.mac_id, this.writeId,
            this.notifyId, formatValue, null)
            .then(characteristic => {
                let resData = Buffer.from(characteristic.value, 'base64').toString('hex')
                console.log('write success1', resData);
            }, error => {
                console.log('write fail: ', error);
                errorCallback(error)
                // alert('write fail: ', error.reason);
            })
    },
    //  三、 设备返回的数据接收
    ReadDeviceInfo( successCallback, errorCallback) {
        this.manager.readCharacteristicForDevice(this.mac_id, Func.bleUUID.deviceInfoUuid,
            Func.bleUUID.varersionUUID, null)
            .then(characteristic => {
                let resData =Buffer.from(characteristic.value, 'base64').toString('ascii')
                successCallback(resData)
            }, error => {
                console.log('read fail: ', error);
                errorCallback(error)
            })
    },
    //手动停止搜索----在搜索里面，可以自己修改
    StopSearchBle(){
        this.manager.stopDeviceScan() .then(res=>{
            console.log('stopDeviceScan success',res);
          
        })
        .catch(err=>{
            console.log('stopDeviceScan fail',err);
            // alert(' Bluetooth disconnection failed :',err)
            errorCallback(err)
        });
    },

    // 关闭蓝牙连接
    DisconnectBle(successCallback, errorCallback) {
        console.log(this.mac_id,'disconnect =====================')

        if(!this.mac_id){
            return
        }
        if(Platform.OS === 'android'){
            this.manager.requestConnectionPriorityForDevice(this.mac_id,ConnectionPriority.High).then((device)=>{

            })
        }
        this.manager.cancelDeviceConnection(this.mac_id)
            .then(res=>{
                console.warn('disconnect success',res);
                global.isConnected = false
                successCallback(res)
            })
            .catch(err=>{
                console.warn('disconnect fail',err);
                // alert(' Bluetooth disconnection failed :',err)
                errorCallback(err)
            })
    },

    //关闭蓝牙模块
    destroy(){
        global.isConnected = false
        console.log('destroy==============')

        this.disconnectedSubscription && this.disconnectedSubscription.remove()
        this.manager && this.manager.destroy();
    },

    //监听蓝牙断开
    onDisconnect(){
        this.manager.onDeviceDisconnected(this.mac_id,(error,device)=>{
            if(error){  //蓝牙遇到错误自动断开
                console.log('onDeviceDisconnected','device disconnect',error);
            }else{
                console.log('蓝牙连接状态',device)
            }
        })
    },

    /**==========工具函数=========**/
 

    //字符转换成16进制
    Char2Hex(str) {
        if (str === "") {
            return "";
        } else {
            var hexCharCode = '';
            for (var i = 0; i < str.length; i++) {
                hexCharCode += (str.charCodeAt(i)).toString(16);
            }
            return hexCharCode //  tuh:  747568
        }
    },

    //字符转换成16进制[转换放到新数组]
    Char2Hex2(str) {
        if (str === "") {
            return "";
        } else {
            var hexCharCode = [];
            for (var i = 0; i < str.length; i++) {
                hexCharCode.push('0x' + (str.charCodeAt(i)).toString(16));
            }
            hexCharCode.join(",");
            return hexCharCode //tuh:  ["0x74", "0x75", "0x68"]
        }
    },


    // ArrayBuffer转16进度字符串示例
    ab2hex(buffer) {
        const hexArr = Array.prototype.map.call(
            new Uint8Array(buffer),
            function (bit) {
                return ('00' + bit.toString(16)).slice(-2)
            }
        )
        return hexArr.join('')
    },

    // 16进制转buffer
    hexStringToArrayBuffer(str) {
        if (!str) {
            return new Uint8Array(0);
        }
        var uint8Array = new Uint8Array(str.length/2);
        let dataView = new DataView(uint8Array.buffer)
        let ind = 0;
        for (var i = 0, len = str.length; i < len; i += 2) {
            let code = parseInt(str.substr(i, 2), 16)
            dataView.setUint8(ind, code)
            ind++
        }
        // console.log(uint8Array)
        return [].slice.call(uint8Array);
    },

    // 10进制转16进制
    ten2Hex(number) {
        return Number(number) < 16 ? '0' + Number(number).toString(16) : Number(number).toString(16)
    },

    // 16进制转10进制整数
    hex2int(hex) {
        var len = hex.length,
            a = new Array(len),
            code;
        for (var i = 0; i < len; i++) {
            code = hex.charCodeAt(i);
            if (48 <= code && code < 58) {
                code -= 48;
            } else {
                code = (code & 0xdf) - 65 + 10;
            }
            a[i] = code;
        }

        return a.reduce(function (acc, c) {
            acc = 16 * acc + c;
            return acc;
        }, 0);
    },

    //16进制转10进制浮点数
    hex2Float(t) {

        t = t.replace(/\s+/g, "");
        if (t == "") {
            return "";
        }
        if (t == "00000000") {
            return "0";
        }
        if ((t.length > 8) || (isNaN(parseInt(t, 16)))) {
            return "Error";
        }
        if (t.length < 8) {
            t = this.FillString(t, "0", 8, true);
        }
        t = parseInt(t, 16).toString(2);
        t = this.FillString(t, "0", 32, true);
        var s = t.substring(0, 1);
        var e = t.substring(1, 9);
        var m = t.substring(9);
        e = parseInt(e, 2) - 127;
        m = "1" + m;
        if (e >= 0) {
            m = m.substr(0, e + 1) + "." + m.substring(e + 1)
        } else {
            m = "0." + this.FillString(m, "0", m.length - e - 1, true)
        }
        if (m.indexOf(".") == -1) {
            m = m + ".0";
        }
        var a = m.split(".");
        var mi = parseInt(a[0], 2);
        var mf = 0;
        for (var i = 0; i < a[1].length; i++) {
            mf += parseFloat(a[1].charAt(i)) * Math.pow(2, -(i + 1));
        }
        m = parseInt(mi) + parseFloat(mf);
        if (s == 1) {
            m = 0 - m;
        }
        return m;
    },

    //浮点数转16进制
    float2Hex(t) {
        if (t == "") {
            return "";
        }
        t = parseFloat(t);
        if (isNaN(t) == true) {
            return "Error";
        }
        if (t == 0) {
            return "00000000";
        }
        var s,
            e,
            m;
        if (t > 0) {
            s = 0;
        } else {
            s = 1;
            t = 0 - t;
        }
        m = t.toString(2);
        if (m >= 1) {
            if (m.indexOf(".") == -1) {
                m = m + ".0";
            }
            e = m.indexOf(".") - 1;
        } else {
            e = 1 - m.indexOf("1");
        }
        if (e >= 0) {
            m = m.replace(".", "");
        } else {
            m = m.substring(m.indexOf("1"));
        }
        if (m.length > 24) {
            m = m.substr(0, 24);
        } else {
            m = this.FillString(m, "0", 24, false)
        }
        m = m.substring(1);
        e = (e + 127).toString(2);
        e = this.FillString(e, "0", 8, true);
        var r = parseInt(s + e + m, 2).toString(16);
        r = this.FillString(r, "0", 8, true);
        return this.InsertString(r, " ", 2).toUpperCase();
    },

    //需要用到的函数
    InsertString(t, c, n) {
        var r = new Array();
        for (var i = 0; i * 2 < t.length; i++) {
            r.push(t.substr(i * 2, n));
        }
        return r.join(c);
    },
    //需要用到的函数
    FillString(t, c, n, b) {
        if ((t == "") || (c.length != 1) || (n <= t.length)) {
            return t;
        }
        var l = t.length;
        for (var i = 0; i < n - l; i++) {
            if (b == true) {
                t = c + t;
            } else {
                t += c;
            }
        }
        return t;
    },

}


