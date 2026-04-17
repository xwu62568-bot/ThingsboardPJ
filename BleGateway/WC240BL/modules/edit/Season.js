import React from 'react'

import {
    View,
    SafeAreaView,
    StyleSheet,
    StatusBar,
    BackHandler,
    Text,
    TouchableOpacity,
    FlatList,
    DeviceEventEmitter,
    NativeModules
} from 'react-native'
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';
import Header from '../../../common/component/Header';
import Icon from "react-native-vector-icons/MaterialIcons";
import WheelPicker from '../../../EB640LC/components/WheelPicker';
import actions from '../../../WV100LR/store/actions/Index';
import SeasonValuePicker from '../../component/SeasonValuePick'
import Func from '../../component/Func';

import bleManager from '../BleManager'

import Command from '../../component/Command';
const mqttManager = NativeModules.RCMQTTManager;

const type_mode = 1
const type_all = 2
const type_month = 3
class SeasonScreen extends React.Component {

    constructor(props) {
        super(props)
        this.alreadySendData=[]
        this.state = {
            seasonData: [],
            tempSeasonArr:[]
        }

        this.routerEvent = this.props.navigation.addListener("blur", payload => {//页面失去焦点

            this.backHandler && this.backHandler.remove();

        });
        this.routerEvent = this.props.navigation.addListener("focus", payload => {//页面获取焦点

            this.backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
                this.back()
                return true
            })
        });

    }
    updateSeasonData() {
        this.state.tempSeasonArr = JSON.parse(this.props.state.Device.season_adjust_month)
        this.state.seasonData = this.props.state.Device.season_adjust_mode == 0 ?
            [{idx:-1, k: global.lang.wc240bl_adjust_all, v: (this.props.state.Device.season_adjust_all>0 ?('+'+this.props.state.Device.season_adjust_all+'%'):(this.props.state.Device.season_adjust_all + '%')) }] : this.loadSeasonData()
        // console.log( this.state.seasonData)
    }
    loadSeasonData() {
        let seasonArr = JSON.parse(this.props.state.Device.season_adjust_month)
        var data = []
        var key = ''
        for (let i = 0; i < seasonArr.length; i++) {
            switch (i) {
                case 0:
                    key = global.lang.wc240bl_january
                    break;
                case 1:
                    key = global.lang.wc240bl_february
                    break;
                case 2:
                    key = global.lang.wc240bl_march
                    break;
                case 3:
                    key = global.lang.wc240bl_april
                    break;
                case 4:
                    key = global.lang.wc240bl_may
                    break;
                case 5:
                    key = global.lang.wc240bl_june
                    break;
                case 6:
                    key = global.lang.wc240bl_july
                    break;
                case 7:
                    key = global.lang.wc240bl_august
                    break;
                case 8:
                    key = global.lang.wc240bl_september
                    break;
                case 9:
                    key = global.lang.wc240bl_october
                    break;
                case 10:
                    key = global.lang.wc240bl_november
                    break;
                case 11:
                    key = global.lang.wc240bl_december
                    break;
            }
            let v = seasonArr[i]
            data.push({idx:i, k: key, v: (v>0?'+'+v:v )+ '%' })

        }
        return data
    }
    back() {
        this.props.navigation.goBack()
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
                                        case type_mode:
                                            attrArray.push({
                                                identifier: Func.wc240bl.season_adjust_mode,
                                                identifierValue: item.value,
                                            })
                                            break;
                                        case type_all:
                                            attrArray.push({
                                                identifier: Func.wc240bl.season_adjust_all,
                                                identifierValue: item.value,
                                            })
                                            break;
                                        case type_month:
                                            attrArray.push({
                                                identifier: Func.wc240bl.season_adjust_month,
                                                identifierValue: item.value,
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
                    }
                }
            })
        

    }

    componentWillUnmount() {
        this.bleListener && this.bleListener.remove()
        this.bleListener = null
    }
    chooseMode() {
        this.seasonModeAlert && this.seasonModeAlert.showDialog(this.props.state.Device.season_adjust_mode)
    }
    chooseValue(item) {
        var defaultV = 0
        if(item.idx==-1){
            let v = this.props.state.Device.season_adjust_all
            if(v<0){
                defaultV = -(v+1)

            }else{
                defaultV = v+99

            }
        }else{
            let seasonArr = JSON.parse(this.props.state.Device.season_adjust_month)
            if(seasonArr){
                let v = seasonArr[item.idx]
                if(v<0){
                    defaultV =  -(v+1)
                }else{
                    defaultV = v+99
                }
            }
           
        }
        this.seasonValueAlert && this.seasonValueAlert.showDialog(defaultV,item.idx,item.k)

    }
    seasonValueConfirm(v, idx) {
        console.log(v, idx)
        var value;
        var ID;


        if (idx == -1) {
            ID = Func.wc240bl.season_adjust_all

            if (v < 99) {
                value = -(v+1)
            } else {
                value = v - 99
            }
            //value = String(value)
        }else{
            ID = Func.wc240bl.season_adjust_month
           

            if (v < 99) {
                value = -(v+1)
            } else {
                value = v - 99
            }
           this.state.tempSeasonArr[idx]=value

           value = JSON.stringify( this.state.tempSeasonArr)

        }


        if(global.isConnected){

            if(idx == -1){
                //全部调 
                this.sendToDevice(Command.seasonAdjustAll(value))
                this.alreadySendData.push({ type: type_all, msgId: global.messageId, value })
            }else{
                //单月调
                this.sendToDevice(Command.seasonAdjustMonth(this.state.tempSeasonArr))
                this.alreadySendData.push({ type: type_month, msgId: global.messageId, value })
            }
           
        }else{
            let attrArray = [{
                        identifier: ID,
                        identifierValue: value,
                    }]
            
            this.sendToServer(attrArray,true)
        } 

    }
    seasonModeConfirm(index) {
        console.log(index)
        let value = index
        if(global.isConnected){
            this.sendToDevice(Command.seasonMode(value))
            this.alreadySendData.push({ type: type_mode, msgId: global.messageId, value })
        }else{
            let attrArray = [{
                        identifier: Func.wc240bl.season_adjust_mode,
                        identifierValue: value,
                    }]
            
            this.sendToServer(attrArray,true)
        } 
    }
    buildData(){
        var items = []

        for (let i = 1; i < 100; i++) {
            items.push( -i+'%')
        }
        for (let i = 0; i <= 100; i++) {
            let add = ''
            if(i!=0){
                add='+'
            }
            items.push( add +i+'%')
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

        const blePackageSize = 20
        if(command.length > blePackageSize){
            //分段发
            let index = 0
            this.sendInterval = setInterval(()=>{
                if(index >= command.length){
                    clearInterval(this.sendInterval)
                    return
                }

                let sliced = command.slice(index,index+blePackageSize)
                index+=blePackageSize
                
                console.log('sliced',Command.hexToString(sliced))
                bleManager.BleWrite(sliced ,(data) => {
                    console.log('蓝牙数据返回===', data)
                }, (err) => {
                    console.log('写入失败===', err)
                })
                
            },100)
        }else{
            bleManager.BleWrite(command, (data) => {
                console.log('蓝牙数据返回===', data)
            }, (err) => {
                console.log('写入失败===', err)
            })
        }        
    }
    _renderItem(item, index) {
        console.log(item)
        return (
            <View >
                {item.idx>0 ?  <View style={{backgroundColor:constants.colors.gray,height:0.5,marginLeft:22,marginRight:22,opacity:0.5}}></View>:null}
              
                <Text style={{ left: 39, fontSize: 18, color: constants.colors.darkGray, ...Platform.select({ ios: { lineHeight: 50 }, android: { height: 50, textAlignVertical: 'center' } }) }}>{item.k}</Text>
                <TouchableOpacity style={{ position: 'absolute', right: 40, height: 50, flexDirection: 'row', alignItems: 'center', }} onPress={this.chooseValue.bind(this,item)} >
                    <Text style={{ fontSize: 18, color: constants.colors.darkGray, ...Platform.select({ ios: { lineHeight: 50 }, android: { height: 50, textAlignVertical: 'center' } }) }}>
                        {item.v}
                    </Text>
                </TouchableOpacity>
            </View>
        )
    }
    render() {
        this.updateSeasonData()

        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />

                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <WheelPicker
                    ref={(e) => { this.seasonModeAlert = e }}
                    ok={global.lang.wc240bl_label_cancel}
                    cancel={global.lang.wc240bl_label_save}
                    alertTitle={global.lang.wc240bl_season_adjust}
                    selectIndex={1}
                    items={[global.lang.wc240bl_adjust_all, global.lang.wc240bl_adjust_month]}
                    comformClik={
                        this.seasonModeConfirm.bind(this)
                    } />
                <SeasonValuePicker
                    ref={(e) => { this.seasonValueAlert = e }}
                    ok={global.lang.wc240bl_label_cancel}
                    cancel={global.lang.wc240bl_label_save}
                    alertTitle={global.lang.wc240bl_season_adjust}
                    selectIndex={1}
                    isCyclic={true}
                    items={this.buildData()}
                    comformClik={
                        this.seasonValueConfirm.bind(this)
                    } />
                <Header left={true} title={global.lang.wc240bl_season_adjust} back={this.back.bind(this)}>
                </Header>
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}>
                    <Text style={{ left: 39, fontSize: 18, color: constants.colors.gray, ...Platform.select({ ios: { lineHeight: 48 }, android: { height: 48, textAlignVertical: 'center' } }) }}>{global.lang.wc240bl_season_adjust}</Text>
                    <TouchableOpacity style={{ position: 'absolute', right: 40, height: 48, flexDirection: 'row', alignItems: 'center', }} onPress={this.chooseMode.bind(this)}>
                        <Text style={{ fontSize: 18, color: constants.colors.gray, ...Platform.select({ ios: { lineHeight: 48 }, android: { height: 48, textAlignVertical: 'center' } }) }}>{this.props.state.Device.season_adjust_mode == 0 ? global.lang.wc240bl_adjust_all : global.lang.wc240bl_adjust_month}</Text>
                        <Icon name={'arrow-forward-ios'} size={18} style={{ color: constants.colors.gray }}></Icon>
                    </TouchableOpacity>

                    <FlatList
                        style={{ borderRadius: 13, backgroundColor: 'white', marginLeft: 18, marginRight: 18 }}
                        data={this.state.seasonData}
                        renderItem={({ item }) => this._renderItem(item)}
                        keyExtractor={(item, index) => index}

                    ></FlatList>

                </SafeAreaView>

            </View>
        )
    }
}


const styles = StyleSheet.create({

})
export default connect((state) => {
    return {
        state
    }
})(SeasonScreen)