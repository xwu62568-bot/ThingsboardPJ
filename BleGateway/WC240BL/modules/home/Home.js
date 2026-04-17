import React, { PureComponent, useState } from 'react'

import {
    View,
    Text,
    SafeAreaView,
    ScrollView,
    Image,
    TouchableHighlight,
    Switch,
    NativeModules,
    findNodeHandle,
    NativeEventEmitter,
    TouchableOpacity,
    StyleSheet,
    Alert,
    ActivityIndicator,
    StatusBar,
    AppState,
    DeviceEventEmitter,
    BackHandler,
    FlatList,
    TouchableWithoutFeedback,
    PermissionsAndroid,
    RefreshControl,
    TextInput,
} from 'react-native'
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';
import Header from '../../../common/component/Header';
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import MaterialIcon from "react-native-vector-icons/MaterialIcons";
import ImageView from '../../../common/component/ImageView';

import actions from '../../../WV100LR/store/actions/Index';
import * as urls from '../../../common/constants/constants_url';
import request from '../../../common/util/request';
import { menuView } from "../../../common/component/menuView";
import Func from '../../component/Func';
import bleManager from '../BleManager'
import Storage from '../../../common/util/asyncstorage';
import commFunc from '../../../common/util/commFunc';
import Command from '../../component/Command';
import Common from "../../../common/constants/constants"
import HSlider from '../../../common/component/HSlider';
import DurationScreen from '../../../WV100LR/components/Duration';
import AlertView from "../../../common/component/AlertView";
import { WaveView } from "../../../common/component/waveView"
import moment from 'moment';
import { loadingView,titleLoading } from "../../../common/component/loadingView";
import CountDown from '../../../common/component/countDownView';

String.prototype.bool = function () {
    return (/^true$/i).test(this);
};

const MQTTManagerEvent = NativeModules.MQTTManagerEvent;

const MQTTManagerEventEmitter = new NativeEventEmitter(MQTTManagerEvent);

const mqttManager = NativeModules.RCMQTTManager;

async function hasAndroidPermission() {
    try{
        const permission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
        const hasPermission = await PermissionsAndroid.check(permission);
        if (hasPermission) {
            return true;
        }
    
        const status = await PermissionsAndroid.request(permission);
        return status === 'granted';
    }catch(err){
        console.log("err",err)
        return false
    }
}

const solarBaseType = ['wc100bls','wc120bls','wc140bls']
class HomeScreen extends React.Component {

    constructor(props) {
        super(props)
        this.count=0
        this.testCount=0
        this.stateChangeListener=null
        this.tempId=''
        this.alreadySendData=[]
        this.recordMsd=0
        this.receiveBuff = []
        this.receiveLength = 0
        this.alreadyCheckRecord = false
        this.hasBeenCalled=false
        this.props.dispatch(actions.Device.initDevice(this.props.route.params));
        this.showDisable =true
        this.state = {
            info: this.props.route.params,
            appState: AppState.currentState,
            data:[],
            connecting : true,
            running:false,
            rainStatus:'',
            soilStatus:'',
            isRefreshing:false,
            site1WithMaster:false //站点1是否 作为主阀打开
        }
      
        this.routerEvent = this.props.navigation.addListener("blur", payload => {//页面失去焦点
            console.log("页面失去焦点")
            this.saveSelectStatus()
            this.backHandler && this.backHandler.remove();

        });
        this.routerEvent = this.props.navigation.addListener("focus", payload => {//页面获取焦点
            console.log('页面获取焦点',global.isConnected,global.autoconnect);
            if( global.isConnected==false&&global.autoconnect==false){
                if(this.tempId){
                    this.connect(this.tempId)
                }
            }
            Storage.get("showHide"+this.state.info.serialNumber).then((result) => {
                this.showDisable = result!=null ? result : true
            })
            this.reloadData()
            if (this.controlSubscription == null) {
                this.controlSubscription = MQTTManagerEventEmitter.addListener(
                    'KMqttControl',
                    (control) => {
                        // let valveStatus = -1;
                        this.handleData(control)
                    },

                );
            }
            this.backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
                this.back()
                return true
            })
            this.getDeviceInfo();
        });

    }

    async  componentDidMount() {

    Storage.get("peripheralID"+this.state.info.serialNumber).then((result) => {
             console.log('readFile peripheralID==',result)
            if(result!=null){
                    this.tempId= result
            }
        })
            .catch((err) => {
                console.log('readFile failure :' + err.message)

            })     


        if (Platform.OS === "android" && !(await hasAndroidPermission())) {
            return;
        }
        loadingView.show();
        setTimeout(() => {
            this.setState({
                connecting:false
            })
            loadingView.hidden();
        }, 16000);  
        this.loadBle()
        Storage.get("showHide"+this.state.info.serialNumber).then((result) => {
            if(result!=null){
                    this.showDisable= result
            }
        })
            .catch((err) => {
                console.log('readFile failure :' + err.message)

            })
        
        //收到监听
        this.listener = DeviceEventEmitter.addListener('requestDeviceInfo', (newOne) => {
            if (this.state.mqttEventCode != 0) {
                mqttManager.connectMqtt(String(this.state.info.serialNumber))
            }
            this.getDeviceInfo();
        })

        this.bleListener = DeviceEventEmitter.addListener('bleListener', (data) => {
            if(data.code == 0){
                console.log("receive data:",Command.hexToString( data.buff))//7b ca 00 0a 01 10 41 01 05 38
                let buff = data.buff
                if(buff){
                    if(Command.CRCCalc(buff,buff.length) == 0){//crc校验通过，整包数据
                        this.handleBlueData(buff)
                    }else{//crc校验失败，分包发来的，
                        //第一包：头(2B) + 长度(2B) + msgId(1B) + 命令(2B)
                        if(buff.length == 20){
                            let headH = buff[0]
                            let headL = buff[1]
                            
                            //确保这是第一包
                            if((headH == 0x7b && headL == 0xca) || (headH == 0x7b && headL == 0xcb) || (headH == 0x7b && headL == 0xcc)){
                                let cmdH = buff[5]
                                let cmdL = buff[6]
                                if(Command.verifyCommand(cmdH,cmdL)){
                                    //同时满足包头和klv，确认是第一包，记录长度
                                    //包长
                                    const length = ((buff[2]&0xFF) << 8) | (buff[3] & 0xFF)
                                    this.receiveBuff = []
                                    this.receiveLength = length
                                    this.receiveBuff.push(...buff)
                                    return
                                }
                            }
                        }
                        if(this.receiveBuff.length > 0){
                            //
                            this.receiveBuff.push(...buff)
                        }
                        //判断长度
                        if(this.receiveBuff.length > 0 && this.receiveBuff.length == this.receiveLength){
                            //长度对了，再看crc
                            if(Command.CRCCalc(this.receiveBuff,this.receiveBuff.length) == 0){
                                //crc验证通过，接收完毕
                                this.handleBlueData(this.receiveBuff)
                                this.receiveBuff = []
                                this.receiveLength = 0
                            }else{
                                loadingView.hidden();
                                titleLoading.hidden();
                            }
                        }
                    }
                }
            }
        })
        
        this.stateChangeSubscription = AppState.addEventListener('change', this._handleAppStateChange);
        // test();      
        // console.log("deviceInfo:" + JSON.stringify(this.state.info));//JSON.stringify(this.props.route.params)
        console.log(1 + JSON.stringify(this.props.state.Device));
        // this.getDeviceInfo();
        mqttManager.connectMqtt(String(this.state.info.serialNumber))

        this.connectSubscription = MQTTManagerEventEmitter.addListener(
            'KMqttConnect',
            (connect) => {
                // Alert.alert(String(this.count++),String(connect.mqttEventCode))
                console.log("event code:" + connect.mqttEventCode);
                // console.log('response:' + connect)
                this.state.mqttEventCode = connect.mqttEventCode
            }
        );
        this.controlSubscription = MQTTManagerEventEmitter.addListener(
            'KMqttControl',
            (control) => {
                // let valveStatus = -1;
                this.handleData(control)
            },

        );
        //console.log('componentDidMount sites:',this.props.state.Device.sites)
    }
    handleBlueData(data){
        console.log("handle BlueData:",Command.hexToString(data))
        let headH = data[0]
        let headL = data[1]
        if(headH == 0x7b && headL == 0xca){//app下发参数
            this.handleReplay(data)
        }else if (headH == 0x7b && headL == 0xcb){//app 请求参数
            this.handleRequest(data)
        }else if (headH == 0x7b && headL == 0xcc){//设备上报
            this.handleReport(data)
        }
        
        this.setState({})
        this.emitViewableSite()
    }
    //处理设备回复
    handleReplay(buff){
        let msgID = buff[4]//消息ID
        let status = buff[5]//返回状态 0成功 1 电量低 2重复操作
        
        if (this.alreadySendData) {//已经发送的数据
            for (let i = 0; i < this.alreadySendData.length; i++) {
                var item = this.alreadySendData[i];
                if (item.msgId == msgID) {
                    if (item.type == 1) {//type 1 开关数据 type 2 校时数据
                        if (status == 0) {//开关阀回复 成功 
                            // this.state.data[item.s - 1].on_off = item.on_off ? false : true
                            console.log("开阀成功")
                        } else if (status == 1) {//开关阀回复 失败
                            // todo 是否重复
                        } else if (status == 2) {//开关重复操作 

                            if (item.onOff) {//显示状态开 下发的是关 冲突说明已经关阀
                                commFunc.alert(global.lang.wc240bl_already_open)
                            } else {
                                commFunc.alert(global.lang.wc240bl_already_close)
                            }
                        
                        }else if (status == 3) {//电量低
                            commFunc.alert(global.lang.wc240bl_battery_empty)
                        }else if (status == 4) {//未接阀
                            commFunc.alert(global.lang.wc240bl_no_exe_as_site_no_valve)
                        }else if (status == 5) {//电量低更换电池
                            commFunc.alert(global.lang.wc240bl_battery_low)
                        }
                        this.alreadySendData.splice(i, 1)//移除当前发送数据
                        
                        if((item.onOff && status != 0) || (!item.onOff && status == 0)){
                            //开阀失败 或 关阀成功 时更新UI
                            this.state.running = false
                        }
                        // console.log(this.alreadySendData,'alreadySendData')
                        break
                    } else if(item.type == 2){//校时
                        if (status == 0) {//校时成功 
                                if(this.state.data){
                                    if(!this.alreadyCheckRecord){
                                        this.getRecords()//如果没有获取过记录，优先获取记录
                                    }else{
                                        this.getDeviceStatus()//获取阀状态
                                    }
                                }
                            
                        } if (status == 1) {//电量低
                            commFunc.alert(global.lang.wc240bl_battery_low)
                        }
                        this.alreadySendData.splice(i, 1)
                        break
                    }else if(item.type == 3){//删除记录
                        loadingView.hidden();
                        titleLoading.hidden();
                        if (status == 0) {//删除成功 
                            this.getDeviceStatus()
                        } 
                        this.alreadySendData.splice(i, 1)
                        break
                    }else if(item.type == 4){//设置开阀时长
                        loadingView.hidden();
                        if (status == 0) {//设置成功 
                            this.saveHowLongToServer()
                        } 
                        this.alreadySendData.splice(i, 1)
                        break
                    }else if(item.type == 5){//禁用启用
                        if(status == 0){
                            let id = '03_' + 'site' + (item.s) + '_disabled'
                            var attrArray =
                                    [
                                        {
                                            identifier: id,
                                            identifierValue: String(item.value),
                                        }
                                    ]
                            this.sendToServer(attrArray,false)
                        }
                        this.alreadySendData.splice(i, 1)
                        break
                    }
                }
            }
        }
    }
    //处理app请求
    handleRequest(buff){
        if (buff.length > 4) {
            let hexStr = bleManager.ab2hex(buff.slice(2, 4))//截取整包包长
            let length = bleManager.hex2int(hexStr) //包长
            let valuesLen = length - 2 - 2 - 1 - 2//除去包头2 包长 2 消息id 1 crc 2
            if(valuesLen==0){//无记录 只返回 msg id 7b cb 00 07 03 bc 1f
              let msd =  buff.slice(4, 5)
              if(msd==this.recordMsd){
                loadingView.hidden();
                titleLoading.hidden();
                this.getDeviceStatus()
              }
              return
            }
            let subBuff = buff.splice(5, valuesLen)//截取到数据段
           
            for (let i = 0; subBuff.length>0; i++) {
                let valueH = subBuff[0]
                let valueL = subBuff[1]
                let cmd = Command.byteToKLV(valueH, valueL)//取到参数小包
                // 动态长度字段：03-03/03-04 长度 = 站点数 * 2（设备可能直接上报，未经过请求组包设置len）
                // 03-03/03-04：如果返回len不可信（例如0），用站点数兜底
                if (cmd.key === 0x03 && (cmd.key_id === 0x03 || cmd.key_id === 0x04) && (!cmd.len || cmd.len === 0)) {
                    cmd.len = (this.state.data ? this.state.data.length : 0) * 2
                }

                // len 仍不合法/数据不够：必须 break，避免 splice(0,0) 死循环
                if (!cmd.len || subBuff.length < 2 + cmd.len) break
                let value = subBuff.slice(2, 2 + cmd.len)//取参数值
                console.log(cmd,Command.hexToString(value))
                if (cmd.key == 0x03 && cmd.key_id == 0x05) {//获取的电量
                    let battery = parseInt(value[0]) / 10
                    this.props.dispatch(actions.Device.updateDevice('battery', battery));
                    console.log(battery,'battery')
                    //太阳能版低电量是7.0v
                    const lowbattery = solarBaseType.includes(this.state.info.baseType) ? 7.0 : 7.3
                    if (battery <= lowbattery) {//低电量 不进行后续操作
                        loadingView.hidden();
                        commFunc.alert(global.lang.wc240bl_battery_empty)
                    } else {
                        this.syncSetting()
                    }
                }else  if (cmd.key == 0x03 && cmd.key_id == 0x06) {//获取时间戳
                    let hexStr = bleManager.ab2hex(value)//截取整包包长
                    let timeStp = bleManager.hex2int(hexStr) //时间戳
                    console.log(timeStp,'timestemp')
                }else  if (cmd.key == 0x03 && cmd.key_id == 0x08) {//土壤传感器状态
                    let status = parseInt(value[0])
                    this.state.soilStatus = String(status )+"%"
                }else  if (cmd.key == 0x03 && cmd.key_id == 0x09) {//雨量传感器状态
                    let status 
                    if (value[0] == 0x00) {//状态
                        status = '0'//干
                    } else {
                        status = '1'//湿
                    }   
                    this.state.rainStatus = status
                    
                }else if (cmd.key == 0x03 && cmd.key_id == 0x01) {//获取的阀状态
                    let data = this.state.data
                    let hasOn = false
                    for(i=0;i<data.length;i++){
                        const mask = 1 << i
                        if((value[0] & mask) != 0){
                            data[i].on_off = true
                            hasOn = true
                        }else{
                            data[i].on_off = false
                        }
                    }
                    this.state.running = hasOn
                   
                } else if(cmd.key == 0x03 && cmd.key_id == 0x02){ //站点一打开时的角色  0：站点1，1：作为主阀
                    this.state.site1WithMaster = (value[0] == 1)
                    //03 01 和  03 02 同时上报，03 01 在前， 在这里处理，因为已经先解析过03 01开关状态了
                    if(this.state.site1WithMaster){
                        //站点1 作为主阀开启
                        let onlySite1Opened = false //只有站点1是打开的
                        let data = this.state.data
                        let openedSites = data.filter(item => item.on_off)
                        if(openedSites.length == 1){
                            if(openedSites[0].s == 1){
                                onlySite1Opened = true
                            }
                        }
                        if(onlySite1Opened){
                            //站点1作为主阀且唯一开启，说明处在延迟关闭的5秒时间内，这时可以再次点击开阀按钮
                            this.state.running = false
                        }
                    }
                }else if(cmd.key == 0x03 && cmd.key_id == 0x03){//站点剩余开阀时长
                    let data = this.state.data
                    if(data.length * 2 == value.length){//数据长度和站点数匹配是否匹配
                        for(let i=data.length-1, j=0; i>=0; i--,j+=2){
                            const site = data[i]
                            const remaining = ((value[j]&0xFF) << 8) | (value[j+1] & 0xFF)
                            if(site.on_off){
                                if(remaining > 0){
                                    site.t = Date.now() + remaining*1000 
                                    console.log("结束时间戳：",site.t,"s:",site.s)
                                }
                            }else{
                                site.t = null
                            }
                        }
                    }
                }else if(cmd.key == 0x03 && cmd.key_id == 0x04){//站点开阀真实时长
                    let data = this.state.data
                    if(data.length * 2 == value.length){//数据长度和站点数匹配是否匹配
                        for(let i=data.length-1, j=0; i>=0; i--,j+=2){
                            const site = data[i]
                            const total = ((value[j]&0xFF) << 8) | (value[j+1] & 0xFF)
                            site.total = total
                            console.log("总时长(秒)：",total,"站点:",site.s)
                        }
                    }
                }else if(cmd.key == 0x06 && cmd.key_id == 0x01){
                    this.recordParse(value)
                }
                subBuff.splice(0, 2 + cmd.len)//截掉已取参数
            }
        }
    }
    //处理设备上报
    handleReport(buff){
        if (buff.length > 4) {
            // 写入数据 [123, 202, 0, 10, 1, 16, 65, 1, 5, 56]
            // write hex: 7bca 000a 01 1041 01 1041 03 0538 7bca000a011041010538
            let hexStr = bleManager.ab2hex(buff.slice(2, 4))//截取整包包长
            let length = bleManager.hex2int(hexStr) //包长
            let valuesLen = length - 2 - 2 - 1 - 2//除去包头2 包长 2 消息id 1 crc 2

            let subBuff = buff.splice(5, valuesLen)//截取到数据段

            for (let i = 0; subBuff.length > 0; i++) {
                let valueH = subBuff[0]
                let valueL = subBuff[1]
                let cmd = Command.byteToKLV(valueH, valueL)//取到参数小包
                // 动态长度字段：03-03/03-04 长度 = 站点数 * 2
               // 03-03/03-04：如果返回len不可信（例如0），用站点数兜底
                if (cmd.key === 0x03 && (cmd.key_id === 0x03 || cmd.key_id === 0x04) && (!cmd.len || cmd.len === 0)) {
                    cmd.len = (this.state.data ? this.state.data.length : 0) * 2
                }

                // len 仍不合法/数据不够：必须 break，避免 splice(0,0) 死循环
                if (!cmd.len || subBuff.length < 2 + cmd.len) break
                let value = subBuff.slice(2, 2 + cmd.len)//取参数值
                console.log('cmdd111',cmd,Command.hexToString(value))
                if ((cmd.key == 0x01 && cmd.key_id == 0x01) || (cmd.key == 0x03 && cmd.key_id == 0x01)) {//改为03-01 ， 01-01废弃（为了兼容） 上报的阀状态 
                    
                    let data = this.state.data
                    let hasOn = false
                    for(i=0;i<data.length;i++){
                        const mask = 1 << i
                        if((value[0] & mask) != 0){
                            data[i].on_off = true
                            hasOn = true
                        }else{
                            data[i].on_off = false
                            data[i].t = null
                        }
                    }

                    this.state.running = hasOn
                    
                        
                } else if (cmd.key == 0x07 && cmd.key_id == 0x01) {//电量等级
                    if (value[0] == 0x00) {//电量正常

                    } else if (value == 0x01) {//电压低于8v
                        commFunc.alert(global.lang.wc240bl_battery_low)
                    } else if (value == 0x02) {//电压低于7.5v
                        commFunc.alert(global.lang.wc240bl_battery_empty)
                    }
                } else if(cmd.key == 0x03 && cmd.key_id == 0x02){ //站点一打开时的角色  0：站点1，1：作为主阀
                    this.state.site1WithMaster = (value[0] == 1)
                    //03 01 和  03 02 同时上报，03 01 在前， 在这里处理，因为已经先解析过03 01开关状态了
                    if(this.state.site1WithMaster){
                        //站点1 作为主阀开启
                        let onlySite1Opened = false //只有站点1是打开的
                        let data = this.state.data
                        let openedSites = data.filter(item => item.on_off)
                        if(openedSites.length == 1){
                            if(openedSites[0].s == 1){
                                onlySite1Opened = true
                            }
                        }
                        if(onlySite1Opened){
                            //站点1作为主阀且唯一开启，说明处在延迟关闭的5秒时间内，这时可以再次点击开阀按钮
                            this.state.running = false
                        }
                    }
                }else if(cmd.key == 0x03 && cmd.key_id == 0x04){//站点开阀真实时长  开阀情况上报时剩余时长和总时长一致
                    let data = this.state.data
                    if(data.length * 2 == value.length){//数据长度和站点数匹配是否匹配
                        for(let i=data.length-1, j=0; i>=0; i--,j+=2){
                            const site = data[i]
                            const total = ((value[j]&0xFF) << 8) | (value[j+1] & 0xFF)
                            site.total = total
                            if(site.on_off){
                                site.t = Date.now() + total*1000 
                                console.log("站点："+(site.s)+" 结束时间戳：",site.t,"总时长(秒)：",total)
                            }else{
                                site.t = null
                            }
                        }
                    }
                }
                subBuff.splice(0, 2 + cmd.len)//截掉已取参数
            }

        }
    }
    //记录解析
    recordParse(value){
        //记录上传至服务器
        //上传成功后删除 设备记录
        //最后进行设备状态同步
        var attrArray = [] 
        let channels = this.props.state.Device.channels
        let offset = 0
        for (let i = 0; value.length > 0; i++) {//每包包含多条记录

            let subValue //取单条记录 单路 组成（开阀时间 开阀时长） 多路（站点 开阀时间 开阀时长）
            let siteNumb //站点
            let datetime  //时间戳
            let how_long  //时长
            let mode //模式
            let result //错误码
            let item
            // if(channels==1){
            //      siteNumb =1
            //      subValue = value.slice(0, 7)
            //      datetime = bleManager.hex2int(bleManager.ab2hex(subValue.slice(0, 4))) 
            //      how_long = bleManager.hex2int(bleManager.ab2hex(subValue.slice(4, 6)))
            //      if(datetime==0&&how_long==0||datetime==65535&&how_long==255){//最后一条不足总长 补0
            //         break
            //      }
            //       item = { 'site': siteNumb, 'datetime': datetime*1000, 'how_long': how_long }

            // }else 
            if(channels == 8){
                subValue = value.slice(0, 10)
                siteNumb = bleManager.hex2int(bleManager.ab2hex(subValue.slice(0, 1)))//站点
                mode = bleManager.hex2int(bleManager.ab2hex(subValue.slice(1, 2))) //操作模式
                result = bleManager.hex2int(bleManager.ab2hex(subValue.slice(2, 3))) //错误码
                datetime = bleManager.hex2int(bleManager.ab2hex(subValue.slice(3, 7))) //时间戳
                how_long = bleManager.hex2int(bleManager.ab2hex(subValue.slice(7, 9)))//时长
                if(datetime==0&&how_long==0||datetime==65535&&how_long==255){//最后一条不足总长 补0 或f
                    break
                }
                //增加毫秒 防止时间戳相同 支路顺序乱掉问题 
                offset++
                if(offset>1000){
                    offset = offset-1000
                }
                item = { 'site': siteNumb,'mode':mode,'result':result, 'datetime': datetime*1000+offset, 'how_long': how_long }

            }else{//1路 2路和4路
                subValue = value.slice(0, 8) // (模式+站点)(1B)+开阀时间点 (4Bytes)+ 开阀时长(2Bytes)
                let modeAndSite = subValue.slice(0, 1) //模式+站点  模式高4位，站点低4位
                siteNumb = modeAndSite & 0xf//站点
                mode = (modeAndSite >> 4) & 0xf//操作模式
                datetime = bleManager.hex2int(bleManager.ab2hex(subValue.slice(1, 5))) //时间戳
                how_long = bleManager.hex2int(bleManager.ab2hex(subValue.slice(5, 7)))//时长
                if(datetime==0&&how_long==0||datetime==65535&&how_long==255){//最后一条不足总长 补0 或f
                    break
                }
                //时间戳在2000年1月1日 946656000 ~ 2001年1月1日 978278400之间的，是脏数据(设备同步时间前的)，不上传
                if(datetime>=946656000 && datetime<=978278400){
                    
                    break
                }
                //增加毫秒 防止时间戳相同 支路顺序乱掉问题 
                offset++
                if(offset>1000){
                    offset = offset-1000
                }
                if(channels == 1){//单路设备，不需要站点号，因为始终是1
                    item = { 'mode':mode,'datetime': datetime*1000+offset, 'how_long': how_long }
                }else{
                    item = { 'site': siteNumb,'mode':mode,'datetime': datetime*1000+offset, 'how_long': how_long }
                }
            }
        

            attrArray.push({
                loraEui: String(this.state.info.serialNumber),
                identifier: Func.wc240bl.record,
                identifierValue: JSON.stringify(item),
            })
            if(channels ==8){
                value.splice(0, 9)//截掉已取记录
            }else{
                value.splice(0, 7)//截掉已取记录
            }
        }
    
        if (attrArray) {
            console.log('records:', attrArray)
            //上传服务器
            console.log(moment().format("===HH:mm:ss==="))
            console.log('=====================上传历史记录========================')
            // titleLoading.hidden();
            this.uploadRecordData(attrArray)
        }
    }

    loadBle(){

        bleManager.Init()
        this.stateChangeListener = bleManager.manager.onStateChange((state) => {
            if (state === 'PoweredOff') {
                global.isConnected = false
                global.isBleOpen = false
                loadingView.hidden()
                titleLoading.hidden()
                this.setState({connecting:false})
                commFunc.alert(global.lang.wc240bl_ble_not_enabled )        
                }
            if (state === 'PoweredOn') {
                global.isBleOpen = true
                if(this.tempId){
                    this.connect(this.tempId)
                }else{
                    if (Platform.OS === "android"){
                        this.connect(this.formatMac())
                    }else{
                        this.search()
                    }
                }
            }
        })

        if (Platform.OS === "android"){
            bleManager.manager.state().then((state) => {
                    if (state === 'PoweredOff') {
                        global.isConnected = false
                        global.isBleOpen = false
                        loadingView.hidden()
                        titleLoading.hidden()
                        this.setState({connecting:false})
                        commFunc.alert(global.lang.wc240bl_ble_not_enabled )      
                    }
                    if (state === 'PoweredOn') {
                        global.isBleOpen = true
                        if(this.tempId){
                            this.connect(this.tempId)
                        }else {
                            this.connect(this.formatMac())
                        }
                    }
                    console.log('android state', state)
                }).catch((err) => {
                    console.log('state fail===', err)
                })
        }
    }
    getDeviceStatus(){
        console.log('=====================获取阀和传感器状态========================')
        //同步阀状态
        let sites = this.props.state.Device.sites
            if(sites){
                this.send(Command.requestDeviceState(sites))
            }
    }

    getRecords(){
            //下载记录
            loadingView.hidden()
            titleLoading.show(global.lang.wc240bl_download_record+'...');
            setTimeout(() => {
                titleLoading.hidden();
                this.setState({
                    isRefreshing: false
                })
            }, 45000);  
            this.alreadyCheckRecord=true
            console.log('=====================下载历史记录========================')
            console.log(moment().format("===HH:mm:ss==="))
            let sites = this.props.state.Device.sites
            this.send(Command.requestRecord(sites))
            this.recordMsd = global.messageId
    }
    getBattery(){
        console.log('=====================获取时间和电量========================')
        this.send(Command.requestTimeAndBattery())
    }
    syncSetting(){
        let device = this.props.state.Device
        let time = moment().unix()
        let offset = device.offset
        console.log('time',time,'offset',offset)
        console.log('=====================下发时间、时区和设置项========================')
        let cmd = Command.syncSetting(device,time,offset)

        this.send(cmd)
        this.alreadySendData.push({ type: 2, msgId: global.messageId })//type 2 校时
    }
    formatMac(){
        let formatMac =''
        let macAddress = global.macAddress
        if(macAddress){
            for(let i =0 ;i<macAddress.length ;i++){
                var c = macAddress[i]                
                if(i%2!=0){
                 formatMac = formatMac + c + ':'
                }else{
                 formatMac =  formatMac +c
                }
            }
            formatMac =formatMac.slice(0,-1)
        }
        return formatMac
    }
    search() {
        bleManager.SearchBle( (device) => {
            // console.log(moment().format("===HH:mm:ss==="))
            this.connect(device.id)
            console.log('蓝牙搜索到的===', device,device.isConnectable)
        }, (err) => {
            console.log('搜索失败===', err)
        }, 8000)
    }
    disconnect() {
          bleManager.DisconnectBle(() => {
            console.log('断开成功',)
        }, err => {
            console.log('断开失败===', err)
        })
    }
    connect(id) {
        this.setState({
            connecting:true
        })
      bleManager.ConnectBle(id, (device) => {
            console.log('连接成功',device)
            this.setState({
                isRefreshing: false
            })
            if(!this.tempId){
                Storage.save("peripheralID"+this.state.info.serialNumber, device.id)
                .then((success) => {
                    console.log('save success', success)
                })
                .catch((err) => {
                    console.log('save failure :' + err.message)
                })
            }
            this.readRssi(device.id)
            this.tempId = device.id
            this.props.state.Device.peerUUID=device.id
            this.setState({connecting:false})
            
            this.sendTimer && clearInterval(this.sendTimer);
            this.sendTimer = setInterval(()=>{
                if(this.deviceInfoReady){//接口取到设备信息了，再请求电量等后续操作
                    //1~4路 蓝牙连接成功 查询电量 校时和时区 下载历史记录 获取开关和传感器状态 
                    // 8路 蓝牙连接成功  校时和时区 下载历史记录 获取开关和传感器状态 
                    let channels = this.props.state.Device.channels

                    if(channels<8){
                        this.getBattery()
                    }else{
                        this.syncSetting()
                    }
                    this.sendTimer && clearInterval(this.sendTimer);
                }
            },500)
         bleManager.ReadDeviceInfo( (data) => {
            console.log('数据返回===', data)
            if(data){
                let result = data.split('-')
                if(result){
                    if (Array.isArray(result) && result.length == 2) {
                         let deviceVer=result[1].replace(/\0/g, '').trim()
                         let ver = this.state.info.firmware
                         console.log(ver,deviceVer,'%%%%%%%%%%%%%')
                          if (!this.hasBeenCalled) {
                                    commFunc.checkFirmware(this.state.info.maxVersion,this.state.info.minVersion,ver)   
                                    this.hasBeenCalled=true
                                }
                        if(ver !=deviceVer){
                            this.props.dispatch(actions.Device.updateDevice('firmware',deviceVer));    
                            this.updateVersion(deviceVer)
                        }
                    }
                }
            }
        }, (err) => {
            console.log('失败===', err)
        })
        }, err => {
            this.setState({connecting:false,isRefreshing: false})
            loadingView.hidden()
            console.log('连接失败===', err)
        })
    }
    readRssi(id){
         bleManager.readRssi( id,(rssi) => {
                console.log('读取信号成功',rssi)
                    global.rssi=rssi
                    this.setState({})
            }, err => {
                console.log('读取信号失败===', err)
            })
    }
    send(value) {
        //蓝牙每包最多20个字节，超过分包发
        if(value.length > 20){
                    //分段发
            let index = 0
            this.sendInterval = setInterval(()=>{
                if(index >= value.length){
                    clearInterval(this.sendInterval)
                    return
                }

                let sliced = value.slice(index,index+20)
                index+=20
                
                console.log('sliced',Command.hexToString(sliced))
                bleManager.BleWrite(sliced ,(data) => {
                    console.log('蓝牙数据返回===', data)
                }, (err) => {
                    console.log('写入失败===', err)
                })
                
            },100)
        }else{
            bleManager.BleWrite(value, (data) => {
                console.log('蓝牙数据返回===', data)
            }, (err) => {
                console.log('写入失败===', err)
            })
        }
    }
    handleData(control) {
        console.log('receive:', control)
        if(control.code != 200 || this.props.state.Device.sites == null){
            //出现错误
            return
        }
        let updateArray = []
        let isSiteChanged = false
        let sites = this.props.state.Device.sites
        let programs = this.props.state.Device.programs
        let isProgramChanged = false

        for (let index = 0; index < control.deviceAttrList.length; index++) {
            let item = control.deviceAttrList[index];
            if(item.identifier == null || item.identifierValue == null){
              continue
            }
              if (item.identifier.indexOf("02") == 0) {
      
                  let onOffMatch = item.identifier.match(Func.wc240bl.site_on_off_reg)
                  if(onOffMatch != null){
                    let site = parseInt(onOffMatch[1])
                    if(site>0 && site <= 8){
                        sites[site-1].on_off = item.identifierValue.bool()
                    }
                    continue;
                  }
                  let howLongMatch = item.identifier.match(Func.wc240bl.site_how_long_reg)
                  if(howLongMatch != null){
                    let site = parseInt(howLongMatch[1])
                    if(site > 0 && site <= 8){
                        sites[site-1].how_long = parseInt(item.identifierValue)*1000
                    }
                    continue;
                  }
                 
              } else if (item.identifier.indexOf("03") == 0) {
                  switch (item.identifier) {
                      case Func.wc240bl.site1_mode:
                        updateArray.push({key:'site1_mode',value:parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.wired_rain_sensor:
                        updateArray.push({key:'wired_rain_sensor',value:item.identifierValue.bool()}); break;
                      case Func.wc240bl.soil_sensor:
                        updateArray.push({key:'soil_sensor',value: parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.standby:
                        updateArray.push({key:'standby',value:item.identifierValue.bool()}); break;
                          break;
                      case Func.wc240bl.season_adjust_mode:
                        updateArray.push({key:'season_adjust_mode',value:parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.season_adjust_all:
                        updateArray.push({key:'season_adjust_all',value:parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.season_adjust_month:
                        updateArray.push({key:'season_adjust_month',value:item.identifierValue}); break;
                      case Func.wc240bl.ec_open_time:
                        updateArray.push({key:'ec_open_time',value:parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.ec_close_time:
                        updateArray.push({key:'ec_close_time',value: parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.manual_time:
                        updateArray.push({key:'manual_time',value:parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.last_sync_time:
                        updateArray.push({key:'last_sync_time',value:parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.last_update_time:
                        updateArray.push({key:'last_update_time',value:parseInt(item.identifierValue)}); break;
                      case Func.wc240bl.current_run_program:
                        updateArray.push({key:'current_run_program',value:parseInt(item.identifierValue)}); break;
                      default :
                          
                          if(item.identifierValue.length == 0) continue;
                       
                          let parameterMatch = item.identifier.match(Func.wc240bl.program_parameter_reg)
                          if(parameterMatch != null){
                            let tag = String(parameterMatch[1]).toLocaleUpperCase()
                            let propram =  programs.filter( t => t.tag == tag )
                            if(propram.length > 0){
                              propram[0].parameter = JSON.parse(item.identifierValue)
                              isProgramChanged=true
                            }
                            break;
                          }
      
                          let timesMatch = item.identifier.match(Func.wc240bl.program_times_reg)
                          if(timesMatch != null){
                            let tag = String(timesMatch[1]).toLocaleUpperCase()
                            let propram =  programs.filter( t => t.tag == tag )
                            if(propram.length > 0){
                              propram[0].times = JSON.parse(item.identifierValue)
                              isProgramChanged=true
                            }
                            break;
                          }
      
                          let how_longMatch = item.identifier.match(Func.wc240bl.program_site_how_long_reg)
                          if(how_longMatch != null){
                            let tag = String(how_longMatch[1]).toLocaleUpperCase()
                            let propram =  programs.filter( t => t.tag == tag )
                           
                            if(propram.length > 0){
                              propram[0].how_long = JSON.parse(item.identifierValue)
                              isProgramChanged=true
                            }
                            break;
                          }
      
                          let disabledMatch = item.identifier.match(Func.wc240bl.site_disabled_reg)
                          if(disabledMatch != null){
                            let site = parseInt(disabledMatch[1])
                            if(site>0 && site <= 8){
                                sites[site-1].disabled = item.identifierValue.bool()
                                isSiteChanged = true
                            }
                            break;
                          }
                          break 
                              
                  }
              } else if (item.identifier.indexOf("08") == 0) {
                  let photoMatch = item.identifier.match(Func.wc240bl.site_photo_reg)
                  if(photoMatch != null){
                    let site = parseInt(photoMatch[1])
                    if(site>0 && site <= 8){
                      sites[site-1].photo = item.identifierValue
                      isSiteChanged = true
                    }
                    continue

                  }
                  let nameMatch = item.identifier.match(Func.wc240bl.site_name_reg)
                  if(nameMatch != null){
                    let site = parseInt(nameMatch[1])
                    if(site>0 && site <= 8){
                      sites[site-1].name = item.identifierValue
                      isSiteChanged = true
                    }
                    continue

                  }
                
              } 
          }
        if(isProgramChanged){
            updateArray.push({key:'programs',value:programs})
        }
        if(isSiteChanged){
            updateArray.push({key:'sites',value:sites})
        }
        if(updateArray.length > 0){
            this.props.dispatch(actions.Device.multipleUpdateDevice(updateArray))
            this.reloadData()
        }
    }

    componentWillUnmount() {
        console.log("componentWillUnmount");
        this.stateChangeSubscription && this.stateChangeSubscription.remove();
        this.connectSubscription && this.connectSubscription.remove();
        this.connectSubscription = null;
        this.controlSubscription && this.controlSubscription.remove();
        this.controlSubscription = null;
        this.listener && this.listener.remove();
        this.stateChangeListener &&this.stateChangeListener.remove()
        this.bleListener&& this.bleListener.remove()
    }
    _handleAppStateChange = (nextAppState) => {
        if (
            this.state.appState.match(/inactive|background/) &&
            nextAppState === 'active'
        ) {
            // Alert.alert('foreground',String(this.state.mqttEventCode))

            this.reconnectInterval = setInterval(() => {
                if (this.reconnectConut == 0) {
                    this.reconnectConut = 5
                    this.reconnectInterval && clearInterval(this.reconnectInterval);
                } else {
                    this.reconnectConut--
                    if (this.state.mqttEventCode != 0) {
                        mqttManager.connectMqtt(String(this.state.info.serialNumber))
                        console.log('reconnecting.........................');
                    }
                }
            }, 1000);
            this.getDeviceInfo();
            if(global.isConnected&&global.isBleOpen){     
                setTimeout(()=>{
                    this.getDeviceStatus()
                }, global.fromota ? 500 : 0)      
           
            console.log('App has come to the foreground!');
           }
           if(global.fromota){
                global.fromota = false
           }
        }
        if(nextAppState.match(/inactive|background/)){
            this.saveSelectStatus()
            console.log('App has come to the background!');
        }
        this.state.appState = nextAppState
    };
    getDeviceInfo() {
        let url = global.urlHost + urls.kUrlDeviceInfo
        let header = { Authorization: this.state.info.Authorization }
        let data = {
            deviceId: this.state.info.deviceId,
        }
        console.log('url', url, data, header);
        request.post(url, data, header,
            (status, code, message, data, share) => {
                // func.formatDeviceModel(this.props.screenProps)
                // console.log("getDeviceInfo:",JSON.stringify(data ,null, "\t"));
                let sites = this.props.state.Device.sites
                let battery =  this.props.state.Device.battery

                let device = Func.formatHyecoDeviceModel(data)
                device.Authorization = this.state.info.Authorization;
                device.offset = this.state.info.offset;
                device.battery =battery
                 
                if(!this.shownSyncTip){
                    let updateTime = device.last_update_time
                    let syncTime = device.last_sync_time
                    if(isNaN(syncTime) || updateTime > syncTime ){
                        commFunc.alert(global.lang.wc240bl_not_been_sync)
                    }
                }
                this.shownSyncTip = true
                 
                for (const key in device.sites) {
                    const site = device.sites[key];
                    site.isloading=false
                   let siteTemp = sites[key]
                    if(siteTemp.on_off){
                        site.on_off = siteTemp.on_off
                        site.t = siteTemp.t
                        site.total = siteTemp.total
                    }
               }
               this.props.dispatch(actions.Device.initDevice(device));
                console.log(device)
                this.reloadData()
                this.deviceInfoReady = 1
            },
            (error) => {
                //this.deviceInfoReady = -1
                loadingView.hidden();
                console.log(error);
            });     
    }
    updateVersion(deviceVer){
            let url =global.urlHost+ urls.kUrlEditDevice
           
            let header = { Authorization: this.state.info.Authorization}
    
            let data = {
                name:this.state.info.name,
                firmware: deviceVer,
                deviceId: this.state.info.deviceId
            }
            console.log(url, data);
            request.post(url, data, header,
                (status, code, message, data, share) => {
                    console.log("data", data);

                },
                (error) => {
                    console.log(error);
                });
    }
    uploadRecordData(record) {
       
        let url = global.urlHost + urls.kUrlIdentifierRecord
        console.log(url);
        let header = { Authorization: this.state.info.Authorization  }
        let data = record
        // console.log(data, header)
        request.post(url, data, header,
            (status, code, message, data, share) => {
                // console.log("upload====", JSON.stringify(data, null, "\t"), 'kkkkkkkkkkkkkkk');
                //删除历史记录
                console.log('=====================删除设备历史记录========================')
                let cmd = Command.deleteRecord()
                this.send(cmd)
                this.alreadySendData.push({ type: 3, msgId: global.messageId })//type 3 删除记录
            },
            (error) => {
                loadingView.hidden();
                titleLoading.hidden();
                this.setState({
                    isRefreshing: false
                })
                console.log('error=====', error);
              
            });
    }
    back() {//返回原生页面
        loadingView.hidden()
        titleLoading.hidden()
        setTimeout(()=>{
            if(global.isConnected&&global.isBleOpen){
                bleManager.DisconnectBle(() => {
                    this.stateChangeListener &&this.stateChangeListener.remove()
                    bleManager.destroy()
    
                    console.log('断开成功',)
                }, err => {
                    console.log('断开失败===', err)
                })
            }else{
                bleManager.destroy()
                this.stateChangeListener &&this.stateChangeListener.remove()
    
            }
           
            mqttManager.backToPrevious();
        },200)
    }
    reloadData(){
        let tempData = []
            if(this.showDisable){
                tempData = this.props.state.Device.sites
            }else{
                for (const key in this.props.state.Device.sites) {
                   console.log(key)
                        const element = this.props.state.Device.sites[key];
                        if(!this.showDisable){
                            if(!element.disabled){
                                tempData.push(element)
                            }
                        }                 
                }
            }
            this.setState({
                data: tempData
            })
     }
    showMenu = (e) => {//显示 隐藏 菜单
        const handle = findNodeHandle(e.target);
          let channels = this.props.state.Device.channels
        if(channels>1){
              NativeModules.UIManager.measure(handle, (x, y, width, height, pageX, pageY) => {
            // console.warn(x, y, width, height, pageX, pageY)
            menuView.show(
                [ this.showDisable ? global.lang.wc240bl_hide_disabled : global.lang.wc240bl_show_disabled,global.lang.wc240bl_edit],
                (index) => {
                    menuView.hidden()

                    if (index == 0) {
                        let status = this.showDisable
                        status = !status

                        console.log('save',status)

                            this.showDisable= status
                        
                        Storage.save("showHide"+this.state.info.serialNumber, status)
                            .then((success) => {
                                console.log('www', success)
                            })
                            .catch((err) => {
                                console.log('save failure :' + err.message)
                            })
                            this.reloadData()

                    } else if(index == 1) {
                        
                        this.props.navigation.navigate('Edit')


                    }
                    console.log(index);
                },
                pageY)

        })
        }else{
                                    this.props.navigation.navigate('Edit')

        }
      

    }
  
    getSigalImageName = (signal) => {
   
            if (!global.isConnected){
                return 'signal_offline'
             }
            if(signal == 100000&&signal==null){
                return 'signal_0'
            } 
            if(signal == 0){
                return 'signal_5'
            }
            
            if(signal >=-50){
                 return 'signal_5'
            }else if(signal >=-70 && signal < -50){
                return 'signal_4'
            } else if(signal >=-80 && signal < -70){
                return 'signal_3'
            } else if(signal >=-90 && signal < -80){
                return 'signal_2'
            }else if(signal <-90){
                return 'signal_1'
            }
     
    }
    longPressAction(item, e) {
        // console.log(e.target);
        // console.log(p);
        let site1Master = (item.s==1 && this.props.state.Device.site1_mode==Func.commonFunc.site1_master)
        if(site1Master){
            return
        }
        if(item.on_off){
            //打开状态时，不允许禁用启用
            return
        }
        const handle = findNodeHandle(e.target);
        console.log(handle);

        NativeModules.UIManager.measure(handle, (x, y, width, height, pageX, pageY) => {
            console.log(x, y, width, height, pageX, pageY)
            let w = (constants.window.width -18*3 )/2
            

            menuView.show(
                [ global.lang.wc240bl_label_disable , global.lang.wc240bl_label_enable],
                (index) => {
                    menuView.hidden()

                    let b = false
                        if (index == 0) {//禁用
                            b = true
                        }
                        
                        if(global.isConnected){
                            item.disabled = b
                            this.send(Command.siteEnable(this.state.data))
                            this.alreadySendData.push({type:5, msgId: global.messageId,s:item.s,value:b})
                        }else{
                            let id = '03_' + 'site' + (item.s) + '_disabled'
                            var attrArray =
                                    [
                                        {
                                            identifier: id,
                                            identifierValue: String(b),
                                        }
                                    ]
                            this.sendToServer(attrArray,false)
                        }
                },
                pageY+90,pageX+w-40)
        })
        
      
    }
    showNote(){

      commFunc.alert(global.lang.wc240bl_device_not_near)
    }
    controlOnOff(item){
        if(this.props.state.Device.standby&&!item.on_off){
            commFunc.alert(global.lang.wc240bl_device_suspended)
            return
        }
        if(item.disabled&&!item.on_off){
             commFunc.alert(global.lang.wc240bl_site_disabled)
             return
        }
        if(global.isConnected){

            let value = Command.siteOnOff(item.s,item.on_off?0:1)

            if(value){
                console.log('=====================开关阀========================')
                item.isloading=true
                item.timer && clearTimeout(item.timer);
                item.timer= setTimeout(() => {
                    item.isloading=false
                    item.timer && clearTimeout(item.timer);
                    this.setState({})
                }, 5000)
                
                this.send(value)
                this.alreadySendData.push({type:1,s:item.s,status:item.on_off,msgId:global.messageId})//type 1 开关数据
            }
            // this.send('7F0207007E')
        }else{
            this.setState({})
          commFunc.alert(global.lang.wc240bl_cant_operate_without_ble)
        }
    }
   
    getBatteryImageName(v){
        let battery = v
        if( !global.isConnected||!global.isBleOpen){
            return 'battery_0'
        }
        //太阳能版本
        if(solarBaseType.includes(this.state.info.baseType)){
            if (battery<7.2) {//低电量
                return 'battery_low'
            }
            
            if (battery<7.5) {
                return 'battery_0'
            }
           
            if (battery<=7.5) {
                return 'battery_2'
            }
            if (battery<=7.6) {
                return 'battery_4'
            }
            if (battery<=7.7) {
                return 'battery_6'
            }
            if (battery<=7.8) {
                return 'battery_8'
            }
            if (battery>=7.9) {//满电
                return 'battery_10'
            }
        }  
            if (battery<7.5) {//低电量
                return 'battery_low'
            }
            
            if (battery<=8) {
                return 'battery_0'
            } 
            if (battery==8.1) {
                return 'battery_1'
            }
            if (battery==8.2) {
                return 'battery_2'
            }
            if (battery==8.3) {
                return 'battery_3'
            }
            if (battery==8.4) {
                return 'battery_4'
            }
            if (battery==8.5) {

                return 'battery_5'
            }
            if (battery==8.6) {
                return 'battery_6'
            }
            if (battery==8.7) {
                return 'battery_7'
            }
            if (battery==8.8) {
                return 'battery_8'
            }
            if (battery==8.9) {
                
                return 'battery_9'
            }
            if (battery>=9) {//满电

                return 'battery_10'

            }

    }
    showAlert = () => {
        this.testCount++
        if(this.testCount==2){
            Alert.alert('电压',String(this.props.state.Device.battery));
            this.testCount=0;
        }
    }
    _onRefresh() {
        console.log('>>下拉刷新>>')
        if(global.isConnected){
            this.setState(() => {
               this.getRecords()
            }) 
        }else{
            this.setState({
                isRefreshing:true,
            })
            setTimeout(() => {
                this.setState({
                    isRefreshing:false,
                })  
            },5000);
        }
       
    }
    showSensorStatus(){
        if(global.isConnected){
            return(
                <View style={{ position: 'absolute', right: 15, top: 5 }}>
            {this.props.state.Device.wired_rain_sensor? (this.state.rainStatus?<Text>{'R:'+(this.state.rainStatus=='0'?global.lang.wc240bl_dry:global.lang.wc240bl_wet)}</Text>:null):null} 
            {this.props.state.Device.soil_sensor!=-1 ?(this.state.soilStatus?<Text>{'S:'+this.state.soilStatus}</Text>:null):null}    
                </View>
            )
        }
        return null
    }
    listHeaderComponent() {
        return (<View style={styles.topHeader}>
            <TouchableHighlight style={{ position: 'absolute', left: 0, top: 0, width: 50, height: 35 }} underlayColor='none' >
                <Image style={{ position: 'absolute', left: 16, top: 10, width: 25, height: 25 }} resizeMode='contain' source={{ uri: this.getSigalImageName(global.rssi) }} />
            </TouchableHighlight>
            {this.props.state.Device.channels<8? <TouchableHighlight style={{position: 'absolute',left:40,top:0,width:50,height:35}} underlayColor='none' onPress={this.showAlert}>
                        <Image style={{left:10,top:15,width:25,height:13}} source={{uri:this.getBatteryImageName(this.props.state.Device.battery)}}/>
              </TouchableHighlight>:null}
         
            {
                this.props.state.Device.standby ?  
                <View style={[styles.statusView,{ backgroundColor:  'red' }]}>
                    <Text style={[styles.statusText,{ color:  'white'}]}>{global.lang.wc240bl_standby}</Text>
                </View> : null
            }
           
            <ImageView style={styles.deviceImage} source={{ uri: global.urlImage + urls.kUrlImage + commFunc.getImgFileID(this.props.state.Device.deviceTypeIcon,2) }} placeholderSource={{ uri: 'placeholder' }} />
            <Image style={{top:15, width: 50, height: 50, resizeMode: 'contain' }} source={{ uri: global.urlImage + urls.kUrlImage + this.props.state.Device.dealerLogFid }} />
            {this.props.state.Device.standby?null:this.showSensorStatus()}
        </View>)
    }
    ListFooterComponent() {
        if(this.props.state.Device.channels == 1){
            return null
        } 
        let allSelected = true
        let sites = this.state.data 
        if(!sites) {
            return
        }
        for(let i=0; i<sites.length; i++){
            const site = sites[i]
            const site1Master = site.s==1 && this.props.state.Device.site1_mode==Func.commonFunc.site1_master
            if(!site1Master && !site.disabled && !site.selected){
                allSelected = false
            }
        }

        return (<View style={styles.footer}>
            <TouchableOpacity style={{width:'70%',flexDirection:'row',alignItems:'center'}} underlayColor='none' onPress={()=> this.setDurAll()}>
                <Text style={{color:constants.colors.darkGray,fontSize:16,paddingLeft:20,...Platform.select({ android: { textAlignVertical:'center' ,height:35}})}}>{global.lang.wc240bl_set_all}
                </Text>
                <MaterialIcon name={'arrow-forward-ios'} size={14} style={{marginLeft:5}}/>
            </TouchableOpacity>
            <TouchableHighlight style={{width:'30%',alignItems:'flex-end',paddingRight:20}} underlayColor='none' onPress={this.selectAll.bind(this,allSelected)}>
                <Text style={{color: constants.colors.themeColor, fontSize: 16}}>{allSelected ? global.lang.wc240bl_none2 : global.lang.wc240bl_all}</Text>
            </TouchableHighlight>
        </View>)
        
    }
    
    itemViews = ({item, index}) => {
        let enabled = !item.disabled && !this.state.running
        let site1Master = (item.s==1 && this.props.state.Device.site1_mode==Func.commonFunc.site1_master)
        return (
            <TouchableWithoutFeedback
                underlayColor='none'
                onLongPress={this.longPressAction.bind(this, item)}>
                <View style={{}}>
                                    
                <View style={[styles.cell, { opacity: enabled ? 1 : item.on_off ? 1 : 0.5 }]}>
                    {item.on_off ? <WaveView
                        site = {item}
                        surfaceWidth={Common.window.width - 20}
                        surfaceHeigth={100}
                        moveYOffset={10}
                        style={styles.waveView}>
                    </WaveView> : null}
                    <TouchableOpacity  style={{ position:'absolute', height:25,width:Common.window.width - 140,left:120,  bottom:0}} >
                        </TouchableOpacity>
                    <TouchableOpacity  style={styles.viewTopLeft} >
                    <View style={styles.viewTopLeft}>
                        <Text style={styles.textTopLeft}>{item.s}</Text>
                    </View>
                    </TouchableOpacity>
                    <TouchableWithoutFeedback
                        underlayColor='none'
                        onPress={this.editSiteName.bind(this,index)}>
                        <View style={styles.cellNameView}>
                            
                            <Text ellipsizeMode='tail' numberOfLines={1} style={{ color:constants.colors.darkGray, maxWidth:Common.window.width - 150,fontSize: 16 }}>{item.name && item.name.length > 0 ? item.name : 'site'+item.s}</Text>
                            <Text style={{ color:constants.colors.darkGray, fontSize: 12, alignSelf:'center'}} > {site1Master ? `(${global.lang.wc240bl_master})` : ''}</Text>
                            <Text style={{ color:'red', fontSize: 12, alignSelf:'center'}} > {(!site1Master && item.disabled) ? `(${global.lang.wc240bl_label_disable})` : ''}</Text>
                        </View>
                    </TouchableWithoutFeedback>
                    {
                        item.on_off ? (item.s == 1 && this.state.site1WithMaster ? null :
                            <CountDown
                                style={{flex:1}}
                                site={item}
                                countDownComplete={()=>{
                                    console.log("倒计时结束")    
                                        this.getDeviceStatus()
                                    }}//倒计时结束更新下阀状态
                            />):(
                            <View style={{ position:'absolute',top:0,left:0,right:0,height: 100,}}>
                                <TouchableWithoutFeedback
                                    underlayColor='none'
                                    disabled={!enabled}
                                    onPress={this.editDuration.bind(this, index)}>
                                    <View style={styles.cellLeftView}>
                                        <View style={{ flexDirection: 'row', marginTop: 5, alignItems: 'center' }}>
                                            <Text style={{ color: constants.colors.themeColor, fontSize: 12 }}>{this.durFormart(item)}</Text>
                                            <Image style={{ marginLeft: 5, width: 10, height: 10 }} source={{ uri: 'edit_blue' }} />
                                        </View>
                                    </View>
                                </TouchableWithoutFeedback>
                                
                                <HSlider
                                    style={[styles.slider,{height:10,backgroundColor : '#00000000'}]}
                                    site={item}
                                    value= {this.sliderValue(item.how_long)}
                                    height={5}
                                    disabled={!global.isConnected || !enabled}
                                    width={Common.window.width - 120}
                                    min={5}
                                    max={600}
                                    step={1}
                                    borderRadius={2.5}
                                    
                                    onComplete={this.durSliderFinsh.bind(this, index)}
                                    minimumTrackTintColor={constants.colors.themeColor}
                                    maximumTrackTintColor={constants.colors.lightGray}
                                    secondTrackTintColor ='#0303fd'/>
                            </View>
                            )                       
                    }
                    

                    {
                        this.props.state.Device.channels == 1 ? null : site1Master ? null :
                        <TouchableWithoutFeedback
                            onPress={enabled ? this.selectValve.bind(this, index):this.selectNull()}>
                            <Image style={{ position: 'absolute', top: 45, right: 20, width: 26, height: 26 }} source={{ uri: !item.disabled && item.selected ? 'selected' : 'unselect' }} />
                        </TouchableWithoutFeedback>
                    }
                    
                </View>
                <View style={styles.cellRightView}>
                        {
                            item.disabled ?
                            <Text style={{color:'red', fontSize:16}}>{global.lang.wc240bl_disabled}</Text>: 
                            <Text style={{ color:constants.colors.darkGray, fontSize: 16 }}>{item.on_off ? global.lang.wc240bl_on : global.lang.wc240bl_off} </Text>
                        }
                    </View>
                </View>
            </TouchableWithoutFeedback>)
    }
    sliderValue(v) {
        let i = parseInt(v)/1000
        i = isNaN(i) ? 5 : i
        return i > 600 ? 600 : i

    }
    durFormart(item){
        let dur = item.how_long/1000
        let H = parseInt(dur/3600)
        let M = parseInt((dur%3600)/60)
        let S = parseInt(dur%60)
        if (H < 10) {
            H = '0' + H;
        } 
        if (M < 10) {
            M = '0' + M;
        } 
        if (S < 10) {
            S = '0' + S;
        } 
        return H + ':' + M + ':' + S
    }
    editSiteName(index){//编辑站点名称
        let site = this.props.state.Device.sites[index] 
        var newName = site.name ?? 'site'+site.s
        let title = global.lang.wc240bl_site_name
        AlertView.show(title,
            <TextInput 
                style={{height:50,  borderBottomColor: 'gray' ,borderBottomWidth:1, width:258}}
                onChangeText={text => {
                    console.log(text,title);
                    let t = global.lang.wc240bl_toolong
                    if(text.length>20){
                        commFunc.alert(t)
                    }else{
                        newName = text
                    }
                }}
                defaultValue={newName}
                />,
                global.lang.wc240bl_label_cancel,
                global.lang.wc240bl_label_save,

            () => { AlertView.hidden()},
            () => {
                if(newName.length > 20){
                    let t = title + global.lang.wc240bl_toolong
                    commFunc.alert(t)
                }else{
                    AlertView.hidden()
                    //准备提交
                    if(site.name != newName){
                        let id = '08_' + 'site' + (index + 1) + '_name'
                        var attrArray =
                                [
                                    {
                                        identifier: id,
                                        identifierValue: newName,
                                    }
                                ]
                        
                        console.log('send:', dic['attrArray']);
                        this.sendToServer(attrArray,false)
                    }
                    
                }
        })
    }
    /**
     * 开阀时长发送到服务器
     */
    saveHowLongToServer(){
        var attrArr = []
        this.state.data.forEach( (site,index) => {
            attrArr.push({
                identifier: "02_site"+(index+1)+"_howlong",
                identifierValue: (site.how_long)/1000,
            })
        })
        this.sendToServer(attrArr,false)
    }
    editDuration(index) {//弹出时长 框
         if(!global.isConnected){
            commFunc.alert(global.lang.wc240bl_fail_connect)
            return
        }

        let site = this.state.data[index]

        this.durAlert && this.durAlert.showDialog(site.how_long/1000,index);
    }
    DURConfirm(value) {//时长 确认修改

        let H = value[0];
        let M = value[1];
        let S = value[2];
        let index = value[3];

        let dur = Number(H) * 3600 + Number(M * 60) + Number(S);
        if (dur < 5) {
            dur = 5;
        }
        dur *= 1000
        let sites = this.state.data
        if(index == -100){
            //选中站点一起设置
            for(let i=0;i<sites.length;i++){
                const site = sites[i]
                const site1Master = site.s==1 && this.props.state.Device.site1_mode==Func.commonFunc.site1_master
                if(!site1Master && !site.disabled && site.selected){
                    site.how_long = dur
                }
            }
        }else{
            let site = sites[index]
            site.how_long = dur
        }
        console.log("一起设置",sites)
        this.setState({
            data: sites
        })
     
        this.setDeviceDurtion()
    }
    durSliderFinsh(index, value) {
       
        let dur = Math.round(value);
        if (dur < 5) {
            dur = 5;
        }
        dur *= 1000
        let sites = this.state.data
        let site = sites[index]
        site.how_long = dur
        this.setState({
            data: sites
        })
        this.setDeviceDurtion()
    }
    setDeviceDurtion(){
        //todo 发给设备，再发给服务器
        if(global.isConnected){
            let sites = this.state.data

            let value = Command.setSiteDuration(sites)

            if(value){
                console.log('=====================设置开阀时长========================')
                
                loadingView.show();
                this.send(value)
                this.alreadySendData.push({type:4,msgId:global.messageId})//type 4 设置时长
            }
            // this.send('7F0207007E')
        }else{
            this.setState({})
            commFunc.alert(global.lang.wc240bl_cant_operate_without_ble)
        }
    }
    setDurAll(){
        if(!global.isConnected){
            commFunc.alert(global.lang.wc240bl_cant_operate_without_ble)
            return
        }
        let hasSelect = false
        let sites = this.state.data
        for(let i=0;i<sites.length;i++){
            const site = sites[i]
            const site1Master = site.s==1 && this.props.state.Device.site1_mode==Func.commonFunc.site1_master
            if(!site1Master && !site.disabled && site.selected){
                hasSelect = true
            }
        }
        if(hasSelect){
            !this.state.running && this.durAlert && this.durAlert.showDialog(0,-100)
        }else{
            commFunc.alert(global.lang.wc240bl_no_site_selected)
        }
    }
    selectAll(allSelected){
        if(this.state.running){
            return
        }
        this.selectChanged = true
        let sites = this.state.data
        for(let i=0; i<sites.length; i++){
            const site = sites[i]
            const site1Master = site.s==1 && this.props.state.Device.site1_mode==Func.commonFunc.site1_master
            if(!site1Master && !site.disabled){
                site.selected = !allSelected
            }
        }
        this.setState({})
    }
    selectNull() {}
    selectValve(index) {
        let sites = this.props.state.Device.sites
        let site = sites[index]
        site.selected = !site.selected

        this.selectChanged = true

        this.props.dispatch(actions.Device.updateDevice('sites', sites));
        
    }
    onOffSelectSite(onOff){
        if(!global.isConnected){
            commFunc.alert(global.lang.wc240bl_cant_operate_without_ble)
            return
        }
        if(onOff && this.props.state.Device.standby){
            commFunc.alert(global.lang.wc240bl_device_suspended)
            return
        }
        let sites = this.state.data
        if(onOff){
            if(this.props.state.Device.channels == 1){
                sites[0].selected = true
            }else{
                var hasSelect = false
                var site1Master = this.props.state.Device.site1_mode == Func.commonFunc.site1_master
                sites.forEach(site => {
                    //站点1主阀，开启时需排除
                    if(site1Master && site.s == 1){
                        site.selected = false
                    }else if(!site.disabled && site.selected){
                        hasSelect = true
                    }
                })
                if(!hasSelect){
                    commFunc.alert(global.lang.wc240bl_no_site_selected)
                    return
                }
            }
        }
        let value = Command.onOffSelectSite(sites,onOff)

        if(value){
            console.log('=====================开关阀========================')
            if(onOff){
                this.setState({
                    running:true
                })
            }
            
            this.send(value)
            this.alreadySendData.push({type:1,onOff,msgId:global.messageId})//type 1 开关数据
        }

    }
    showLog(){
        this.count++
        if (this.count==8) {
            this.controlSubscription && this.controlSubscription.remove();
            this.controlSubscription = null;
            this.props.navigation.navigate('AutoTest',this.props.state.Device)
            this.count=0
        }
    }
    emitViewableSite(){
        console.log("emitViewableSite")
        let sites = this.state.data
        let keys = []
        for(const key in sites){
            const element = sites[key]
            if(element.on_off){
                keys.push(element.s)
            }
        }
        DeviceEventEmitter.emit('viewableIndexs', keys);
    }
    saveSelectStatus(){//保存站点选中状态
        if(this.selectChanged){
            this.selectChanged = false
            let sites = this.state.data
            if(sites == null) return
            let selectedSites = []
            sites.forEach((site,index)=>{
                let obj = {}
                let key = 'site'+(index+1)
                if(site.disabled){
                    obj[key] = false
                    selectedSites.push(obj)
                }else{
                    obj[key] = site.selected == true
                    selectedSites.push(obj)
                }
            })
            let selectObj = {
                identifier: Func.wc240bl.selected_sites,
                identifierValue: JSON.stringify(selectedSites,""),
            }
            let attrArr = []
            attrArr.push(selectObj)
            console.log('send selectChanged:', attrArr);
            this.sendToServer(attrArr,false)
        }
    }
    /**
     * 发送到服务器
     * @param {Array} attrArray 
     * @param {boolean} includeLastUpdateTime 
     */
    sendToServer(attrArray,includeLastUpdateTime){
        if(includeLastUpdateTime){
            attrArray.push({
                identifier:Func.wc240bl.last_update_time,
                identifierValue:new Date().getTime()
            })
        }
        var dic = {
            attrArray:attrArray
        }
        console.log('send:',dic['attrArray']);
        
        mqttManager.controlDeviceWithDic((dic))
    }
    render() {

        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />

                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <DurationScreen
                    ref={(e) => { this.durAlert = e }}
                    ok={global.lang.wc240bl_label_cancel}
                    cancel={global.lang.wc240bl_label_save}
                    alertTitle={global.lang.wc240bl_duration}
                    subTitle1={global.lang.wc240bl_hour}
                    subTitle2={global.lang.wc240bl_minute}
                    subTitle3={global.lang.wc240bl_second}
                    comformClik={
                        this.DURConfirm.bind(this)
                    }
                />
                <Header left={true} title={this.props.state.Device.name} back={this.back.bind(this)}>
                    <View style={{flexDirection:'row'}}>
                        <TouchableHighlight underlayColor='none' style={styles.menuTouch} onPress={this.showMenu}>
                            <Icon style={styles.meunIcon} name="dots-horizontal" size={30} ></Icon>
                        </TouchableHighlight>
                    </View>
                </Header>
                  <TouchableOpacity style={{top:0,position:'absolute',left:50,width:constants.window.width-100,height:80}} onPress={this.showLog.bind(this)}>
                                    <Text></Text>
                                </TouchableOpacity>
                <SafeAreaView style={{ flex: 1, backgroundColor: constants.colors.lightGray }}>
                <FlatList
                            key={`flatlist_`} // 核心解决：numColumns变化时key随之改变
                            
                            ListHeaderComponent={this.listHeaderComponent()}
                            ListFooterComponent={this.ListFooterComponent()}
                            data={this.state.data}
                            renderItem={this.itemViews}
                            keyExtractor={(item,index)=>index}
                            refreshControl={
                                <RefreshControl
                                    refreshing={this.state.isRefreshing}
                                    tintColor={'gray'}
                                    size={'default'}
                                    onRefresh={() => {
                                        this._onRefresh()
                                    }}
                                />
                            }
                        ></FlatList>
                        <View style={{ height: 85 }}>
                            <View style={styles.btnContainer}>
                                <TouchableOpacity underlayColor="whitesmoke"
                                    style={[styles.btnStyle1,{opacity:!global.isConnected || this.state.running?0.5:1}]}
                                    disabled={!global.isConnected || this.state.running}
                                    onPress={this.onOffSelectSite.bind(this, true)}>
                                    <Text style={{ color: 'white', fontSize: 14 }}>{global.lang.wc240bl_open}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    underlayColor="whitesmoke"
                                    style={[styles.btnStyle2,{opacity:!global.isConnected?0.5:1}]}
                                    disabled={!global.isConnected}
                                    onPress={this.onOffSelectSite.bind(this, false)}>
                                    <Text style={{ color: 'white', fontSize: 14 }}>{global.lang.wc240bl_close}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                        {this.state.connecting?null:global.isConnected?null: <TouchableHighlight underlayColor='none' onPress={this.showNote.bind(this)}>
                <Text style={{bottom:20,fontSize:15,textAlign:'center',textDecorationLine:'underline'}}>{global.lang.wc240bl_fail_connect}</Text>
                </TouchableHighlight>}
               
                </SafeAreaView>

            </View>
        )
    }
}


const styles = StyleSheet.create({
    topHeader: {
        width: '100%',
        backgroundColor: constants.colors.lightGray,
        height: 240,
        alignItems: 'center',
        justifyContent: 'center',
        // flexDirection:'row',
        // backgroundColor: 'red'
    },
    footer:{
        backgroundColor: 'white',
        height: 70,      
        borderRadius: 13,
        marginLeft: 10,
        marginRight: 10,
        flexDirection:'row',
        justifyContent:'center',
        alignItems:'center'
    },
    deviceImage: {
        width: 150,
        height: 150,
        marginTop:15,
        // backgroundColor:'red',
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusText: {
        fontSize: 15,
        color: constants.colors.darkGray,
        // backgroundColor :'#0000000',
        textAlign: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        paddingLeft: 10,
        paddingRight: 10,
        ...Platform.select({
            ios:{
                paddingBottom: 5,
                paddingTop: 5,
            },
            android: {
                paddingBottom: 0,
                paddingTop: 0,
                textAlignVertical:'center',
                height:30 }
        })
    },
    statusView: {
        top: 10,
        right: 15,
        position: 'absolute',
        borderRadius: 12,
        backgroundColor: constants.colors.statusColor
    },
    menuTouch: {
        // backgroundColor:'green',
        // position:'absolute',
        // right:-5,
        bottom: 0,
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    meunIcon: {
        // justifyContent: 'center',
        // padding:"50%",
        alignItems: 'center',
        justifyContent: 'center',
        color: constants.colors.gray
    },
    cell:{
         backgroundColor: 'white',
        marginBottom: 10,
        marginLeft: 10,
        marginRight: 10,
        borderRadius: 13,
        // borderWidth:1,
        // borderColor:'#dcdcdc',
        height: 100,
        flexDirection: 'row',
        alignItems: 'center',
        // paddingLeft: 10,
    },
    slider: {
        // flex: 1,
        position: 'absolute',
        top:53,
        width: Common.window.width - 120,
        left: 35,
    },
    waveView: {
        position:'absolute',
        borderRadius: 13,
        bottom:0,
        backgroundColor: '#b7e3f9'
    },
    viewTopLeft: {
        position: 'absolute',
        top: 0,
        width: 26,
        height: 26,
        borderTopLeftRadius: 13,
        borderBottomRightRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#DDE5EB'
    },
    textTopLeft: {
        color: '#fff',
        fontSize: 15,
        backgroundColor: 'transparent',
        color: constants.colors.darkGray,
        textAlign: 'center',
    },
    cellLeftView: {
        position: 'absolute',
        ...Platform.select({
            ios: { bottom: 10 },
            android: { bottom: 10 }
        }), marginLeft: 35, //width: 70
    },
    cellNameView: {
        position: 'absolute',
        flexDirection:'row',
        ...Platform.select({
            ios: { top: 15 },
            android: { top: 8 }
        }), marginLeft: 35, //width: 70
    },
    cellRightView: {
        position: 'absolute',
        ...Platform.select({
            ios: { top: 15 },
            android: { top: 8 }
        }), right: 28, //width: 70
    },
    btnContainer: {
        flexDirection: 'row',
        // backgroundColor:'red',
        height: 45,
        width: Common.window.width,
        marginBottom: 20
    },
    btnStyle1: {
        height: 33,
        width: 100,
        justifyContent: 'center',
        alignItems: 'center',
        // borderWidth: 1,
        borderRadius: 17,
        marginTop: 12,

        marginLeft: (Common.window.width - 200 - 30) / 2,
        backgroundColor: constants.colors.themeColor
    },
    btnStyle2: {
        height: 33,
        width: 100,
        justifyContent: 'center',
        alignItems: 'center',
        // borderWidth: 1,
        borderRadius: 17,
        marginLeft: 30,
        marginTop: 12,
        backgroundColor: constants.colors.themeColor

    },
})

export default connect((state) => {
        // console.log("DeviceInfo:",JSON.stringify(state ,null, "\t"));
    return {
        state
    }
})(HomeScreen)

