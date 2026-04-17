import React from 'react'
import {
    View,
    Text,
    SafeAreaView,
    FlatList,
    Dimensions,
    StyleSheet,
    TouchableOpacity,
    TouchableHighlight,
    TextInput,
    NativeModules,
    Platform,
    DeviceEventEmitter,
    Image
} from 'react-native'

import constants from '../../../common/constants/constants';
import Header from '../../../common/component/Header';
import Common from "../../../common/constants/constants";
import Icon from "react-native-vector-icons/MaterialIcons";
import AlertView from "../../../common/component/AlertView";
import { connect } from 'react-redux'
import * as urls from '../../../common/constants/constants_url';
import  request from '../../../common/util/request';
import commFunc from '../../../common/util/commFunc';
import WheelPicker from '../../../EB640LC/components/WheelPicker';
import Func from '../../component/Func';
import actions from '../../../WV100LR/store/actions/Index'
import ECScreen from '../../../WV100LR/components/ECMode';
import bleManager from '../BleManager'

import Command from '../../component/Command';

const sub_id_device_name = 1
const sub_id_site_port = 2
const sub_id_wired_rain_sensor = 3
const sub_id_soil_sensor = 4
const sub_id_standby = 5
const sub_id_season_adjust = 6

const sub_id_ec = 7


const mqttManager = NativeModules.RCMQTTManager;

class Edit extends React.Component{
    constructor(props){
        super(props)
        this.alreadySendData=[]
        this.state = {
            deviceInfo:[],
            Device:this.props.state.Device
        }
        this.routerEvent = this.props.navigation.addListener("focus", payload => {//页面获取焦点
            console.log('页面获取焦点');
            // global.autoconnect=true

        });
    }
    
    componentDidMount(){
        //蓝牙监听
        this.bleListener = DeviceEventEmitter.addListener('bleListener', (data) => {
            console.log( "edit receive data",data)//7b ca 00 0a 01 10 41 01 05 38
            if(data.code==0){
                // this.buffer__ = this.buffer__.concat(data.buff)
                var buffer = data.buff
                console.log( "edit receive data",Command.hexToString(data.buff))//7b ca 00 0a 01 10 41 01 05 38
                //校验crc
                if(buffer && Command.CRCCalc(buffer,buffer.length) == 0){
                    console.log( "CRC校验成功")//7b ca 00 0a 01 10 41 01 05 38
                    
                    let headH = buffer[0]
                    let headL = buffer[1]
                    

                    if (headH == 0x7b && headL == 0xca) {//app 下发参数
                        let msgId = buffer[4]//判断messageId
                        let status = buffer[5]//结果 0是成功
                        console.log("设备返回结果：",status)
                        if(status != 0) return
                        for (let i = 0; i < this.alreadySendData.length; i++) {
                            var item = this.alreadySendData[i];
                            if (item.msgId == msgId) {
                                let attrArray = []
                                switch(item.type){
                                    case sub_id_standby:
                                        attrArray.push({
                                            identifier: Func.wc240bl.standby,
                                            identifierValue: item.value,
                                        })
                                        break;
                                    case sub_id_site_port:
                                        attrArray.push({
                                            identifier: Func.wc240bl.site1_mode,
                                            identifierValue: item.value,
                                        })
                                        break;
                                    case sub_id_soil_sensor:
                                        attrArray.push({
                                            identifier: Func.wc240bl.soil_sensor,
                                            identifierValue: item.value,
                                        })
                                        break;
                                    case sub_id_wired_rain_sensor:
                                        attrArray.push({
                                            identifier: Func.wc240bl.wired_rain_sensor,
                                            identifierValue: item.value,
                                        })
                                        break;
                                    case sub_id_ec:
                                        attrArray.push({
                                            identifier: Func.wc240bl.ec_open_time,
                                            identifierValue: item.ECOn,
                                        })
                                        attrArray.push({
                                            identifier: Func.wc240bl.ec_close_time,
                                            identifierValue: item.ECOff,
                                        })
                                        break;
                                }
                                if(attrArray.length > 0){
                                    this.sendToServer(attrArray,false)
                                }
                                this.alreadySendData.splice(i, 1)//移除当前发送数据
                                break;           
                            }
                        }
                    }
                }else{
                    //校验crc失败
                    console.log( "planList receive data 校验失败",Command.hexToString(buffer))//7b ca 00 0a 01 10 41 01 05 38
                }
                
            }
        })
    }
    componentWillUnmount(){
        this.bleListener && this.bleListener.remove()
        this.bleListener = null
    }
    updateDeviceInfo(){
        this.state.Device = this.props.state.Device
        let arr = [
            {id:sub_id_device_name, k:global.lang.wc240bl_device_name,v:this.props.state.Device.name},
            {id:sub_id_site_port,h:global.lang.wc240bl_site1_mode_description, k:global.lang.wc240bl_site1_mode,v:this.props.state.Device.site1_mode==Func.commonFunc.site1_normal ?global.lang.wc240bl_site1_normal :global.lang.wc240bl_master},
            {id:sub_id_wired_rain_sensor,h:global.lang.wc240bl_rain_sensor_description, k:global.lang.wc240bl_rain_sensor,v:this.props.state.Device.wired_rain_sensor? global.lang.wc240bl_yes : global.lang.wc240bl_no },
            {id:sub_id_soil_sensor,h:global.lang.wc240bl_soil_sensor_description, k:global.lang.wc240bl_soil_sensor,v: this.props.state.Device.soil_sensor==-1 ? global.lang.wc240bl_no:('>'+this.props.state.Device.soil_sensor + '%') },
            {id:sub_id_standby,h:global.lang.wc240bl_standby_description, k:global.lang.wc240bl_standby,v:this.props.state.Device.standby ? global.lang.wc240bl_yes : global.lang.wc240bl_no },
            {id:sub_id_season_adjust,h:global.lang.wc240bl_season_adjust_description, k:global.lang.wc240bl_season_adjust,v:this.props.state.Device.season_adjust_mode=='0'?global.lang.wc240bl_adjust_all:global.lang.wc240bl_adjust_month},
            {id:sub_id_ec,h:global.lang.wc240bl_ec_description, k:global.lang.wc240bl_ec_time,v: this.ecFormart(this.props.state.Device.ec_open_time,this.props.state.Device.ec_close_time)},
           
        ]
        if(this.props.state.Device.channels==8){
            arr.splice(1,1)
            arr.splice(3,1)
        }else  if(this.props.state.Device.channels==1){
            arr.splice(1, 1)
        }
        this.state.deviceInfo = [
            {key:"1",k:'',v: arr},
            {key:"2",k:global.lang.wc240bl_technical_info,v:''},
            {key:"5",k:'OTA',v:''},
            {key:"4",k:global.lang.wc240bl_help,v:''},
           
        ]
        // console.log("device:",JSON.stringify(this.props.state.Device ,null, "\t"));
    }
    back(){
        this.props.navigation.goBack()
    }
    ecFormart(start,stop){
        let openMValue = parseInt(start/60)
        let openSValue = parseInt(start%60)
        let closeMValue = parseInt(stop/60)
        let closeSValue = parseInt(stop%60)
        if (openMValue < 10) {
            openMValue = '0' +parseInt(openMValue);
        }

        if (openSValue < 10) {
            openSValue = '0' + parseInt(openSValue);
        }

        if (closeMValue < 10) {
            closeMValue = '0' + parseInt(closeMValue);
        }

        if (closeSValue < 10) {
            closeSValue = '0' + parseInt(closeSValue);
        }
        let ecText= openMValue + ':' + openSValue + '/'  + closeMValue + ':' + closeSValue 
        return ecText;
    }
    durFormart(dur){
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
    StatusConfirm(index) {//status 确认修改
        let value =  index === 0 
        if(global.isConnected){
            this.sendToDevice(Command.standyBy(value))
            this.alreadySendData.push({ type: sub_id_standby, msgId: global.messageId, value })
        }else{
            let attrArray = [{
                        identifier: Func.wc240bl.standby,
                        identifierValue: value,
                    }]
            
            this.sendToServer(attrArray,false)
        }
    }
    WiredRainSensorConfirm(index){
        let value =  index === 0 
        if(global.isConnected){
            this.sendToDevice(Command.rainSensor(value))
            this.alreadySendData.push({ type: sub_id_wired_rain_sensor, msgId: global.messageId, value})
        }else{
            let attrArray = [{
                        identifier: Func.wc240bl.wired_rain_sensor,
                        identifierValue: value,
                    }]
            
            this.sendToServer(attrArray,false)
        }
    }
    Site1Confirm(index){
        let value =  index === 0 ? Func.commonFunc.site1_master : Func.commonFunc.site1_normal
        if(global.isConnected){
            this.sendToDevice(Command.site1Master(value))
            this.alreadySendData.push({ type: sub_id_site_port, msgId: global.messageId, value })
        }else{
            let attrArray = [{
                        identifier: Func.wc240bl.site1_mode,
                        identifierValue: value,
                    }]
            
            this.sendToServer(attrArray,false)
        }
    }

    soilSensorConfirm(index){
        let value = index === 0 ? '-1':String(index-1)
        if(global.isConnected){
            this.sendToDevice(Command.soilSensor(value))
            this.alreadySendData.push({ type: sub_id_soil_sensor, msgId: global.messageId, value })
        }else{
            let attrArray = [{
                        identifier: Func.wc240bl.soil_sensor,
                        identifierValue: value,
                    }]
            
            this.sendToServer(attrArray,false)
        }       
    }

    ECConfirm(value) {//EC 确认修改
        // alert(value)
        //最短5s
        let openMValue = Number(value[0])
        let openSValue = Number(value[1])
        let closeMValue = Number(value[2])
        let closeSValue = Number(value[3])

        if(openSValue<5&&openMValue==0){
            openSValue = 5;
        }
        if(closeSValue<5&&closeMValue==0){
            closeSValue = 5;
        }
        let ecStart = openMValue*60+openSValue
        let ecStop = closeMValue*60+closeSValue
        
        var ECOn = ecStart.toString();
        var ECOff = ecStop.toString();
        if(global.isConnected){
            
            this.sendToDevice(Command.ecTime(ecStart,ecStop))
            this.alreadySendData.push({ type: sub_id_ec, msgId: global.messageId, ECOn, ECOff})

        }else{
            
            let attrArray =
                [
                    {
                        identifier:Func.wc240bl.ec_close_time,
                        identifierValue:ECOff,
                    },
                    {
                        identifier:Func.wc240bl.ec_open_time,
                        identifierValue:ECOn,
                    }                   
                ]
            this.sendToServer(attrArray,false)
        }
    }
   
    editDevice(){
            let url =global.urlHost+ urls.kUrlEditDevice
           
            let header = { Authorization: this.state.Device.Authorization }

            var deviceName = this.state.Device.name

            this.state.deviceInfo[0].v.forEach((it) =>{
                if(it.id == sub_id_device_name){
                    
                    deviceName = it.v
                    return
                }
            });
            if(deviceName > 20){
                return
            }
    
            let data = {
                name: deviceName.length==null?'':deviceName,
                deviceId:this.state.Device.deviceId
            }
            console.log(url, data);
            request.post(url, data, header,
                (status, code, message, data, share) => {
                    console.log("data", data);
                    this.props.dispatch(actions.Device.updateDevice('name',deviceName));    
                },
                (error) => {
                    console.log(error);
                });
    }
    deleteDevice(){
        AlertView.show("",
        <Text style={{marginLeft:15,marginRight:15,fontSize:16,textAlign:'center',alignItems: 'center'}}>
        {global.lang.wc240bl_delete_device_alert}
        </Text>,global.lang.wc240bl_label_cancel, global.lang.wc240bl_ok,
            
            () => { AlertView.hidden()  },
            () => {
                AlertView.hidden()
                let url =global.urlHost+ urls.kUrlUnbindDevice
          
                let header = { Authorization: this.state.Device.Authorization }
               
                let data = {
                    userId: this.state.Device.userId,
                    deviceId:this.state.Device.deviceId
                }
                console.log(url, data);
                request.post(url, data, header,
                    (status, code, message, data, share) => {
                        console.log("data", data);
                        // this.props.navigation.goBack()
                    mqttManager.backToPrevious();

                    },
                    (error) => {
                        console.log(error);
                    });
            })
            
     

    }
 
    callBack(index,subId){
        console.log(index+" - "+subId);
        if(index == 1){
            let device = this.state.Device
            if(subId == sub_id_device_name){
                var newName = device.name
                let title = global.lang.wc240bl_label_device_name
                AlertView.show(title,
                    <TextInput 
                        style={{height:50,  borderBottomColor: 'gray' ,borderBottomWidth:1, width:258}}
                        onChangeText={text => {
                            console.log(text,title);
                            let t = global.lang.wc240bl_toolong
                            if(text.length>20){
                                commFunc.alert(t)
                            }else if(text.length == 0){
                                newName = device.name
                            }else{
                                newName = text
                            }
                        }}
                        defaultValue={device.name}
                        />,
                        global.lang.wc240bl_label_cancel,
                        global.lang.wc240bl_label_save,
    
                    () => { AlertView.hidden()},
                    () => {
                        if(newName.length > 20){
                            let t = title + global.lang.el100lr_toolong
                            commFunc.alert(t)
                        }else{
                            AlertView.hidden()
                            //准备提交
                            let tempArr = this.state.deviceInfo
                            tempArr[0].v.forEach((it) =>{
                                if(it.id == sub_id_device_name){
                                    if(device.name != newName){
                                        it.v = newName
                                        this.editDevice()
                                        this.setState({
                                            deviceInfo : tempArr
                                        })
                                    }
                                    return
                                }
                            });
                        }
                })
            }else if(subId == sub_id_soil_sensor){
                var index 
                if(this.props.state.Device.soil_sensor==-1){
                    index = 0
                }else{
                    index = (this.props.state.Device.soil_sensor)+1
                }
                this.modeAlert && this.modeAlert.showDialog(index)
               
            }else if(subId == sub_id_season_adjust){
                this.props.navigation.navigate('Season')

              
            }else if(subId == sub_id_site_port){
                this.site1Alert && this.site1Alert.showDialog(this.state.Device.site1_mode == Func.commonFunc.site1_master ? 0:1)
            }else if(subId == sub_id_standby){
                this.statusAlert && this.statusAlert.showDialog(this.state.Device.standby ? 0:1)
            }else if(subId == sub_id_wired_rain_sensor){
                this.wiredRainSensorAlert && this.wiredRainSensorAlert.showDialog(this.state.Device.wired_rain_sensor ? 0 : 1)
            }else if(subId == sub_id_ec){
                this.ecAlert && this.ecAlert.showDialog(this.props.state.Device.ec_open_time,this.props.state.Device.ec_close_time);

            }
            
        }else if(index=='4'){//帮助页面
            commFunc.goToHelpPage(this.state.Device.pageId)
        }else if(index=='5'){//OTA页面
            if(Platform.OS === 'ios'){
                global.autoconnect=false

                if(global.isConnected == true){
                    bleManager.DisconnectBle(() => {
                        global.isConnected = false
                        console.log('断开成功',)
                        mqttManager.goToOTAPage(this.state.Device)
                    }, err => {
                        console.log('断开失败===', err)
                    })
                }else{
                    mqttManager.goToOTAPage(this.state.Device)
                }
            }else{
                global.fromota = true
                //为了解决：有些字段的值是NaN，作为参数传递到原生模块时会报异常
                const device = JSON.parse(JSON.stringify(this.state.Device))
                mqttManager.goToOTAPage(device)
            }  
        }
    }
 
  
    buildData(){
        var items = []
        items.push(global.lang.wc240bl_no)

        for (let i = 0; i <= 99; i++) {
            items.push( '>'+i+'%')
        }
        return items
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
    //给设备发送指令
    sendToDevice(command){
        if(global.isConnected != true){
            commFunc.alert(global.lang.wc240bl_cant_operate_without_ble)
            return
        }
        this.messageId = global.messageId
        bleManager.BleWrite(command, (data) => {
            console.log('蓝牙数据返回===', data)
        }, (err) => {
            console.log('写入失败===', err)
        })
        
    }
    render(){
        this.updateDeviceInfo()
        return(
            <View style={{ flex: 1 }}>
                 <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <SafeAreaView style={{ flex: 1 }}>
                    <WheelPicker
                        ref={(e) => { this.statusAlert = e }}
                        ok={global.lang.wc240bl_label_cancel}
                        cancel={global.lang.wc240bl_label_save}
                        alertTitle={global.lang.wc240bl_standby}
                        selectIndex={1}
                        items={[global.lang.wc240bl_yes,global.lang.wc240bl_no]}
                        comformClik={
                           this.StatusConfirm.bind(this)
                        }/>
                    <WheelPicker
                        ref={(e) => { this.wiredRainSensorAlert = e }}
                        ok={global.lang.wc240bl_label_cancel}
                        cancel={global.lang.wc240bl_label_save}
                        alertTitle={global.lang.wc240bl_rain_sensor}
                        selectIndex={1}
                        items={[global.lang.wc240bl_yes,global.lang.wc240bl_no]}
                        comformClik={
                           this.WiredRainSensorConfirm.bind(this)
                        }/>
                  
                    <WheelPicker
                        ref={(e) => { this.site1Alert = e }}
                        ok={global.lang.wc240bl_label_cancel}
                        cancel={global.lang.wc240bl_label_save}
                        alertTitle={global.lang.wc240bl_site1_mode}
                        selectIndex={0}
                        items={[global.lang.wc240bl_master,global.lang.wc240bl_site1_normal]}
                        comformClik={
                           this.Site1Confirm.bind(this)
                        }/>
                    <WheelPicker
                        ref={(e) => { this.modeAlert = e }}
                        ok={global.lang.wc240bl_label_cancel}
                        cancel={global.lang.wc240bl_label_save}
                        alertTitle={global.lang.wc240bl_soil_sensor}
                        subTitle={global.lang.wc240bl_stop_watering}
                        selectIndex={0}
                        isCyclic={true}
                        items={this.buildData()}
                        comformClik={
                            this.soilSensorConfirm.bind(this)
                        }/>
                           <ECScreen
                        ref={(e) => { this.ecAlert = e }}
                        ok={global.lang.wc240bl_label_cancel}
                        cancel={global.lang.wc240bl_label_save}
                        alertTitle={global.lang.wc240bl_ec_time}
                        subTitle1={global.lang.wc240bl_ec_open}
                        subTitle2={global.lang.wc240bl_ec_close}
                        comformClik={
                            this.ECConfirm.bind(this)
                        }
                    />
                    
                    <Header left={true} title={global.lang.wc240bl_label_edit} back={this.back.bind(this)}/>
                      
                    <FlatList
                    style={styles.flagStyle}
                    data={this.state.deviceInfo}
                    renderItem={({ item, index })=>
                        <CellComponent itemkey={item.k} itemvalue={item.v} index={item.key} device={this.state.Device} callBack={this.callBack.bind(this)}></CellComponent>
                    }
                    // keyExtractor={index => index}
                    ></FlatList>
                    
                </SafeAreaView>
                <SafeAreaView></SafeAreaView>
                <View style={styles.btnContent}>
                        <TouchableHighlight underlayColor='none' style={styles.btnStyle} onPress={() => {this.deleteDevice()}}>
                            <Text style={{color:constants.colors.darkGray}}>{global.lang.wc240bl_label_delete}</Text>
                        </TouchableHighlight>
                    </View>
            </View>
        )
    }
}
class CellComponent extends React.Component{

    constructor(){
        super()
        this.state = {
            Info:[],
            iconName:[
                "",
                "",
                "arrow-forward-ios",
                "arrow-forward-ios",
                "arrow-forward-ios",
                "arrow-forward-ios",
                "arrow-forward-ios",
            ],
            text:''
        }
    }
   componentDidMount()
   {
        console.log(this.props.itemkey,this.props.index);
        if(this.props.index=='2'){
            this.setState({
                Info:[                
                        {k:global.lang.wc240bl_brand,v:this.props.device.brand},
                        {k:global.lang.wc240bl_type,v:this.props.device.productType},
                        {k:global.lang.wc240bl_serial,v:this.props.device.serialNumber},
                        {k:global.lang.wc240bl_mac,v:this.props.device.macAddress},
                        {k:global.lang.wc240bl_hardware,v:this.props.device.hardware},
                        {k:global.lang.wc240bl_firmware,v:this.props.device.firmware},
                    ],
            })
        }
       
   }

    selectItem = (index,id)=>{
        this.props.callBack&&this.props.callBack(index,id)
    }
    render(){
        return(
            this.props.index == '1' ? 
            <TouchableOpacity activeOpacity={1}  key={this.props.index} style={[styles.infoCellStytle,{marginTop:13}]}>
                {
                    this.props.itemvalue.map((item, index) => {
                                    return (
                                        <View style={[styles.subCellStytle,{marginTop:index==0?5:0,marginBottom:index==this.props.itemvalue.length-1?5:0}]}>
                                            <TouchableOpacity style={[styles.dataStyle,{flexDirection:'row',marginLeft:0}]} onPress={()=>{ item.h && commFunc.alert(item.h)}}>
                                                <Text numberOfLines={1} ellipsizeMode='middle' style={[{}]}>{item.k}: </Text>
                                                {item.h && <Image style={{width: 15, height:15 }} source={{ uri: 'infor' }} />}
                                            </TouchableOpacity>
                                            <TouchableOpacity  style={{  height:45,flexDirection: 'row',alignItems: 'center',}}  activeOpacity={0.5}  onPress={this.selectItem.bind(this,this.props.index,item.id)}>
                                                <Text style={styles.dataValueStyle} numberOfLines={1} >
                                                    {item.v}
                                                </Text>
                                                <Icon name={'arrow-forward-ios'} size={18} style={styles.arrowStyle}></Icon>
                                            </TouchableOpacity>
                                        </View>
                                    )
                                })
                }
            </TouchableOpacity> 
            :
            this.props.index == '2' ? 
            <TouchableOpacity activeOpacity={1}  key={this.props.index} style={[styles.infoCellStytle]}>
                <Text style={styles.infoTextStytle}>
                <Text style={styles.dataTechInfo}>
                        {this.props.itemkey+''}
                    </Text>
                </Text >
                {this.state.Info.map(
                                    (item, index) => {
                                        return (
                                        <View style={styles.infoSubTextStyle} key={index}>
                                                <Text style={{ color:constants.colors.darkGray}}>{item.k+':'}</Text>
                                                <Text style={{ color:constants.colors.darkGray}}> {item.v}</Text>
                                        </View>
                                        )
                                    }
                                )}
            </TouchableOpacity> 
            :
            <TouchableOpacity activeOpacity={0.5}  key={this.props.index} style={[styles.cellStytle]} onPress={this.selectItem.bind(this,this.props.index,-1)}>
                <Text numberOfLines={1} style={styles.dataStyle}>
                    {this.props.itemkey+ (this.props.itemvalue.length==0 ? '':':'+this.props.itemvalue )}
                </Text>
                {String(this.state.iconName[this.props.index])=="" ?null:<Icon name={this.state.iconName[this.props.index]} size={18} style={styles.arrowStyle}></Icon>}
            </TouchableOpacity>
        )
    }
}
const w = (Common.window.width-30)/3
const styles = StyleSheet.create({
    flagStyle:{
        // marginLeft:10,
        // marginRight:10,
        // marginTop:10,
        paddingBottom:100,
        // borderWidth:1,
        // borderRadius:5,
    },
    cellStytle: {
        height: 66,
        marginLeft: 15,
        marginRight: 15,
        marginBottom:13,
        borderRadius: 13,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor:'white'
    },
    subCellStytle: {
        marginLeft:15,
        height:45,
        flexDirection: 'row',
        alignItems: 'center',
    },
    infoCellStytle: {
       // height: 260,
        marginLeft: 17,
        marginRight: 17,
        borderRadius: 13,
        marginBottom:13,
        // flexDirection: 'column',
        alignItems:'flex-start',
        backgroundColor:'white'
    },
 
    infoTextStytle:
    {
        // position:'absolute',
        marginTop:15,
        marginLeft:15,
        marginBottom:5,
        height:30,
        textAlign:'left',
        // backgroundColor:'green'
    },
    infoSubTextStyle:{
        marginLeft:15,
        height:30,
        bottom:5,
        flexDirection: 'row',
        // width:80,
        // backgroundColor:'red'
    },
    infoSubTextValueStyle:{
        marginRight:15,
        height:20,
        // flexDirection: 'column',
        // width:80,
        // backgroundColor:'red'
    },
    dataTechInfo : {
        marginLeft:15,
        textAlign:'left',
        color:constants.colors.darkGray,
        fontWeight : 'bold'
    },
    dataStyle: {
        marginLeft:17,
        textAlign:'left',
        color:constants.colors.darkGray,
        flex:1,
        // width:w,
        // backgroundColor:'#999902'
    },
    dataValueStyle: {
        marginLeft:10,
        marginRight:38,
        textAlign:'right',
        //
        color:constants.colors.darkGray,
        // width:w,
        // backgroundColor:'#999902',
        ...Platform.select({
            ios:{lineHeight:35},
            android:{
                height:35, 
                textAlignVertical:'center'}
        })
    },
    arrowStyle: {
        position: 'absolute',

        right:15,
        // textAlign:'left',
        // width:w,
        // backgroundColor:'#999902'
    },
    timeStyle: {
        width:w,
        justifyContent: 'center',
        alignItems: 'center',
        // backgroundColor:'#991502'

    },
    durStyle: {
        width:w,
        justifyContent: 'center',
        alignItems: 'center',
        // backgroundColor:'#562327'

    },
    container: {
        backgroundColor: 'white',
        flex: 1,
    },
    switchContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginVertical: 50,
        flexWrap: 'wrap',
    },
    switch: {
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'black',
        marginVertical: 2,
        paddingVertical: 10,
        width: Dimensions.get('window').width / 3,
    },
    btnContent: {
        height:100,
        backgroundColor: 'white'
    },
    btnStyle:{
        marginTop:25,
        marginLeft:25,
        marginRight:25,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
        // borderWidth: 1,
        borderRadius: 25,
        // marginLeft: 10,
        // marginRight:10,
        // marginTop: 5,
        // marginBottom:5,
        backgroundColor:constants.colors.lightGray
    },
  
});
export default connect((state) => {
    // console.log("DeviceInfo:",JSON.stringify(state ,null, "\t"));
    return {
        state
    }
})(Edit);
