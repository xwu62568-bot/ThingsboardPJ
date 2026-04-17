import React, { useState } from 'react'

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


} from 'react-native'
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';
import Header from '../../../common/component/Header';
import Icon from "react-native-vector-icons/MaterialCommunityIcons";

import actions from '../../../WV100LR/store/actions/Index';
import * as urls from '../../../common/constants/constants_url';
import ImageView from "../../../common/component/ImageView";
import { menuView } from "../../../common/component/menuView";
import Storage from '../../../common/util/asyncstorage';
import Func from '../../component/Func';
import commFunc from '../../../common/util/commFunc';
import moment from 'moment';
import Command from '../../component/Command';
import bleManager from '../BleManager'

const MQTTManagerEvent = NativeModules.MQTTManagerEvent;

const MQTTManagerEventEmitter = new NativeEventEmitter(MQTTManagerEvent);

const mqttManager = NativeModules.RCMQTTManager;

class SitesScreen extends React.Component {

    constructor(props) {
        super(props)
        this.showDisable=true,
        this.syncSnapShot=null
        this.state = {
            info: this.props.route.params,
            tempID:'',
            data: [ ],
        }

        this.routerEvent = this.props.navigation.addListener("blur", payload => {//页面失去焦点
            this.bleListener && this.bleListener.remove()
            this.bleListener = null
            this.backHandler && this.backHandler.remove();

        });
        this.routerEvent = this.props.navigation.addListener("focus", payload => {//页面获取焦点
            console.log('页面获取焦点');
            Storage.get("showHide"+this.state.info.serialNumber).then((result) => {
                this.showDisable = result!=null ? result : true
                this.reloadData()
            })

            console.log(JSON.stringify(this.props.state.Device.sites ,null, "\t"))
         
            this.backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
                this.back()
                return true
            })
            this.initBleListener()
        });

    }

    initBleListener(){
        this.alreadySendData = []
        //蓝牙监听
        this.bleListener = DeviceEventEmitter.addListener('bleListener', (data) => {
            console.log( "sites receive data",data)//7b ca 00 0a 01 10 41 01 05 38
            if(data.code==0){
                // this.buffer__ = this.buffer__.concat(data.buff)
                var buffer = data.buff
                console.log( "sites receive data",Command.hexToString(data.buff))//7b ca 00 0a 01 10 41 01 05 38
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
                                
                                let id = '03_' + 'site' + (item.s) + '_disabled'
                                var attrArray =
                                    [
                                        {
                                            identifier: id,
                                            identifierValue: String(item.value),
                                        }
                                    ]
                                var dic = {
                                    attrArray:attrArray
                                }
                                console.log('send:',dic['attrArray']);
                                mqttManager.controlDeviceWithDic((dic))
                                this.setState({
                                    tempID: id
                                })
                                this.alreadySendData.splice(i, 1)
                            }
                        }
                    }
                }
            }
        })
    }
    componentDidMount() {

        Storage.get("showHide"+this.state.info.serialNumber).then((result) => {
            this.showDisable = result!=null ? result : true
        })
            .catch((err) => {
                console.log('readFile failure :' + err.message)

            })
        
            this.controlSubscription = MQTTManagerEventEmitter.addListener(
                'KMqttControl',
                (control) => {
                    console.log(' receive111:', control)
                    if(control.code != 200){
                        //出现错误
                        return
                    }
                  
                    for (let index = 0; index < control.deviceAttrList.length; index++) {
                        let item = control.deviceAttrList[index];
                        switch(item.identifier){
                            case this.state.tempID: 
                                this.reloadData()
                            break;
                           
                        }
                    }
                    
                },
    
            );

       
    }

    componentWillUnmount() {
        console.log("componentWillUnmount");
        this.controlSubscription && this.controlSubscription.remove();
        this.controlSubscription = null;
    }

    back() {//返回原生页面

        this.props.navigation.goBack()
    }
    
    reloadData(){//处理页面数据刷新 cell不上移问题 
     
        let tempData = []
            if(this.showDisable&&this.props.state.Device.site1_mode==Func.commonFunc.site1_normal){
                tempData = this.props.state.Device.sites
            }else{
                for (const key in this.props.state.Device.sites) {
                    const element = this.props.state.Device.sites[key];
                        if(!this.showDisable){
                            if(!element.disabled){
                                if(key==0){
                                    if(this.props.state.Device.site1_mode!=Func.commonFunc.site1_master){
                                        tempData.push(element)
                                    }
                                }else{
                                    tempData.push(element)
                                }
                            }
                        }else{
                            if(key==0){
                                if(this.props.state.Device.site1_mode!=Func.commonFunc.site1_master){
                                    tempData.push(element)
                                }
                            }else{
                                tempData.push(element)
                            }
                        }                        
                }
            }
        Storage.get("syncSnapShot" + this.state.info.serialNumber).then((result) => {
            console.log('readFile syncSnapShot==', JSON.stringify(result))
            if (result != null) {
                this.siteNextRun(tempData, result.program)
                this.syncSnapShot = result.program
                // let current_run_program = this.props.state.Device.current_run_program
                // let program = this.props.state.Device.programs[current_run_program - 1]
                // this.syncSnapShot=program
            } else {
                this.setState({
                    data: tempData
                })
                this.syncSnapShot = null
            }
        })
            .catch((err) => {
                console.log('readFile failure :' + err.message)

            })     

           
     }
     siteNextRun(tempData,program){
        if(program){
            for (const key in tempData) {
                const site = tempData[key];
                let isInclude = false
                for (const key in program.how_long) {
                   const item = program.how_long[key];
                   var allKeys = Object.keys(item)
                   if (allKeys.includes(String(site.s))) {
                       isInclude = true
                       break
                   } else {
                       isInclude = false
                   }
               }
               if(isInclude){
                   let text =this.calculateTime(program)
                   site.nextTime=text?global.lang.wc240bl_next_time+':'+ text:''
               }else{
                   site.nextTime = ''
               }
           }
        }

        this.setState({
            data: tempData
        })

     }

     findRunWeekDay(weekdays,addDay,program){

        let nowZero = moment().startOf('day');//获取当天 0:0:0
          nowZero =  moment(nowZero).add(addDay, 'day')//增加 1天
        let weekOfDay =  moment(nowZero).isoWeekday()//获取周几 1周一 7周日
        let isCurrent = weekdays[weekOfDay-1]//当天 允许运行 
        // console.log(isCurrent,weekdays,'weekdays',nowZero,weekOfDay,addDay)

        if(isCurrent){
          let text = this.findNextTime(program,nowZero)
          if(text==''){
            if(addDay>14){
                return ''
            }else{
                return this.findRunWeekDay(weekdays,addDay+1,program)
            }
          }
            return text
        }else{            
            if(addDay>7){
                return ''
            }else{
                return this.findRunWeekDay(weekdays,addDay+1,program)
            }
        }
     }
     findRunEvenOdd(even_odd,skip_days,addDay,program){

        let nowZero = moment().startOf('day');//获取当天 0:0:0
          nowZero =  moment(nowZero).add(addDay, 'day')//增加 1天
        let weekOfDay =  moment(nowZero).isoWeekday()//获取周几 1周一 7周日
        let day = moment(nowZero).date()//获取几号
        let isCurrent = skip_days[weekOfDay-1]//当天 不允许运行 
        let dayEvenOdd
        if(day%2==0){//当天是偶数天 
            dayEvenOdd =Func.commonFunc.even_day
        }else{
            dayEvenOdd =Func.commonFunc.odd_day
        }   
        // console.log(skip_days,'skip_days',nowZero,'weekOfDay',weekOfDay,'day',day,'even_odd',even_odd,'dayEvenOdd',dayEvenOdd,addDay)

        if(isCurrent){
            return this.findRunEvenOdd(even_odd,skip_days,addDay+1,program)
        }else{      
           
            if(even_odd==Func.commonFunc.odd_day) {
                if(dayEvenOdd==Func.commonFunc.odd_day){
                    let text = this.findNextTime(program,nowZero)
                    if(text==''){
                      if(addDay>365){
                          return ''
                      }else{
                          return this.findRunEvenOdd(even_odd,skip_days,addDay+1,program)
                      }
                    }
                      return text
                }else{//+1天接着找
                    if(addDay>365){//超过1年还找不到 不再查找
                        return ''
                    }
                    return this.findRunEvenOdd(even_odd,skip_days,addDay+1,program)
                }
            }else{
                if(dayEvenOdd==Func.commonFunc.even_day){
                    let text = this.findNextTime(program,nowZero)
                    if(text==''){
                      if(addDay>365){
                          return ''
                      }else{
                          return this.findRunEvenOdd(even_odd,skip_days,addDay+1,program)
                      }
                    }
                      return text
                }else{//+1天接着找
                    if(addDay>365){
                        return ''
                    }
                    return this.findRunEvenOdd(even_odd,skip_days,addDay+1,program)
                }
            }  
        }
     }
     findRunInterval(interval,skip_days,zeroTS,program,addDay){
        if(addDay>365){//超过1年 未找到 不再做查找
            return ''
        }
        let  intervalTime =  moment(zeroTS).add(addDay, 'day')//增加天数
         
        let weekOfDay =  moment(intervalTime).isoWeekday()//获取周几 1周一 7周日

        let isCurrent = skip_days[weekOfDay-1]//跳过那天 不允许运行 
        addDay = addDay+interval+1

        // console.log(zeroTS,'sync_time',intervalTime,'syncTime',skip_days,'skip_days',weekOfDay,'weekOfDay',interval,'interval',addDay,'addDay')
        if(isCurrent){
            return this.findRunInterval(interval,skip_days,zeroTS,program,addDay)
        }else{      
            let text = this.findNextTime(program,intervalTime)
            if(text==''){
             return this.findRunInterval(interval,skip_days,zeroTS,program,addDay)
                }
            return text
        }
     }
    findNextTime(program,findDate){
        let zeroTS = parseInt(moment(findDate).format('x'))
        let  nowTS = parseInt(moment().format('x'))

        for(let i = 0;i<program.times.length;i++){//筛出当前查出日期的 下一次定时
            let time = program.times[i]
            let tempTS = zeroTS+parseInt(time)*1000
            if (tempTS>nowTS) {
            let local =  moment(tempTS).local()
            let next =   moment(local).format('MM/DD HH:mm')
                return next
            }
        }
        return ''

    }
     calculateTime(program){

         //周循环模式下 取消跳过周几 
         let skipdays = program.parameter.skip_days
         if (program.parameter.repeat_mode == Func.commonFunc.repeat_mode_week) {
             skipdays = '0000000'
         }

        let skip_days  =  Func.commonFunc.parseWeekSelect(skipdays)

        if(program.parameter.repeat_mode==Func.commonFunc.repeat_mode_week){
            let weekdays  =  Func.commonFunc.parseWeekSelect(program.parameter.weekdays)
            let set = Array.from(new Set(weekdays))

            if(set.length==1){//未选择 周几 直接返回
                if(!set[0]){
                    return ''
                }
            }
            console.log(weekdays,'weekdays')

            for(let i=0;i<weekdays.length;i++){
                if(weekdays[i]&&!skip_days[i]){//没有跳过这周几 
                    weekdays[i]=true
                }else{
                    weekdays[i]=false
                }
            }

             return this.findRunWeekDay(weekdays,0,program)

        }else if(program.parameter.repeat_mode==Func.commonFunc.repeat_mode_interval){
            let interval_days =  program.parameter.interval_days
            let last_sync_time = this.props.state.Device.last_sync_time
            let set = Array.from(new Set(skip_days))
           

            if(set.length==1){//一周全部跳过 直接返回空
                if(set[0]){
                    return ''
                }
            }
            let nowTS = parseInt(moment().format('x'))
                nowTS = nowTS - 365*24*3600*1000 //超过1年未同步 不做检查
            if(last_sync_time<nowTS){
                return ''

            }
            if(last_sync_time&&last_sync_time!=0&&last_sync_time!=null){
                let hour=  moment(last_sync_time).hour()
                let minute=  moment(last_sync_time).minute()
                let second=  moment(last_sync_time).second()
                    
                let zeroTS= last_sync_time -(hour*3600+minute*60+second)*1000   //取同步当天0点
        
                return this.findRunInterval(interval_days,skip_days,zeroTS,program,0)
            }else{
                return ''
            }

        }else if(program.parameter.repeat_mode==Func.commonFunc.repeat_mode_even_odd){
            let set = Array.from(new Set(skip_days))

            if(set.length==1){//一周全部跳过 直接返回空
                if(set[0]){
                    return ''
                }
            }
            let even_odd = program.parameter.even_odd
            return this.findRunEvenOdd(even_odd,skip_days,0,program)   
            
        }
     
        return ''
     }
     showMenu = (e) => {//显示 隐藏 菜单
        const handle = findNodeHandle(e.target);
         let channels = this.props.state.Device.channels
         
            if(channels==1){
  this.props.navigation.navigate('Edit')
            }else{
   NativeModules.UIManager.measure(handle, (x, y, width, height, pageX, pageY) => {
            // console.warn(x, y, width, height, pageX, pageY)

            menuView.show(
                [ this.showDisable ? global.lang.wc240bl_hide_disabled : global.lang.wc240bl_show_disabled,global.lang.wc240bl_edit],
                (index) => {
                    menuView.hidden()

                    if (index == 0) {
                         // console.log('3', !this.state.showAllSites)
                         let status = this.showDisable
                         status = !status
                         this.showDisable= status,
                         Storage.save("showHide"+this.state.info.serialNumber, status)
                             .then((success) => {
                             })
                             .catch((err) => {
                                 console.log('save failure :' + err.message)
                             })
                             this.reloadData()
                    } else {
                        this.props.navigation.navigate('Edit')
                      
                    }
                    console.log(index);
                },
                pageY)

        })
            }

     

    }
    showCardMenu = (item,e) => {//显示 隐藏 菜单
        const handle = findNodeHandle(e.target);
        NativeModules.UIManager.measure(handle, (x, y, width, height, pageX, pageY) => {
            console.log(x, y, width, height, pageX, pageY,constants.window.height)
            let channels = this.props.state.Device.channels
            if(channels==1){
                this.props.navigation.navigate('SiteEdit', item)
            } else{
                  menuView.show(
                [global.lang.wc240bl_label_disable , global.lang.wc240bl_label_enable,global.lang.wc240bl_edit],
                (index) => {
                    menuView.hidden()
                    if (channels == 1) {
                        this.props.navigation.navigate('SiteEdit', item)

                    } else {
                        if (index == 2) {
                            this.props.navigation.navigate('SiteEdit', item)


                        } else {

                            let b = false
                            if (index == 0) {//禁用
                                b = true
                            }

                            if(global.isConnected){
                                console.log("站点",this.state.data)
                                item.disabled = b
                                this.sendToDevice(Command.siteEnable(this.state.data))
                                this.alreadySendData.push({msgId: global.messageId,s:item.s,value:b})
                            }else{
                                let id = '03_' + 'site' + (item.s) + '_disabled'
                                var dic = {
                                    attrArray:
                                        [
                                            {
                                                identifier: id,
                                                identifierValue: String(b),
                                            }
                                        ]
                                }

                                console.log('send:', dic['attrArray']);
                                mqttManager.controlDeviceWithDic((dic))
                                this.setState({
                                    tempID: id
                                })
                            }
                            
                        }
                    }

                },
                pageY,pageX)
            }
          

        })

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
    timingDetail(site) {
        if(this.syncSnapShot!=null){
            let isInclude = false

            for (const key in this.syncSnapShot.how_long) {
                const item = this.syncSnapShot.how_long[key];
                var allKeys = Object.keys(item)
                if (allKeys.includes(String(site.s))) {
                    isInclude = true
                    break
                } else {
                    isInclude = false
                }
            }
            if (isInclude) {
                this.props.navigation.navigate('PlanListScreen', { site: site.s })
            } else {
                commFunc.alert(global.lang.wc240bl_site_is_not_planned)
    
            }
        }else{
            commFunc.alert(global.lang.wc240bl_synchronized_error)

        }
       

    }
    setSiteName(item){
        if(item.s==1){
            return global.lang.wc240bl_site1
        }else  if(item.s==2){
            return global.lang.wc240bl_site2
        }else  if(item.s==3){
            return global.lang.wc240bl_site3
        }else  if(item.s==4){
            return global.lang.wc240bl_site4
        }else if(item.s==5){
            return global.lang.wc240bl_site5
        }else  if(item.s==6){
            return global.lang.wc240bl_site6
        }else  if(item.s==7){
            return global.lang.wc240bl_site7
        }else  if(item.s==8){
            return global.lang.wc240bl_site8
        }
        
    }
    listItem = ({item,index}) => {  
        let w = (constants.window.width -18*3 )/2
            return (

                <TouchableOpacity style={{marginTop:12,marginLeft:18,width:w,height:189,backgroundColor:'white',borderRadius:13}} onPress={this.timingDetail.bind(this,item)}>
                 
                <ImageView style={{height:107, borderTopLeftRadius: 13,borderTopRightRadius:13}} source={{uri:item.photo==null?'garden': global.urlImage+ urls.kUrlImage + item.photo}} placeholderSource={{uri:'garden'}}/>
                <View style={{height:82, borderBottomLeftRadius: 13,borerBottomRightRadius:13,opacity: item.disabled ? 0.5 :1}}>
                <Text style={{marginLeft:13,marginTop:13,fontSize:15,color:constants.colors.darkGray}}>{item.name ?item.name:this.setSiteName(item)}</Text>
                <Text  style={{marginLeft:13,fontSize:13,color:constants.colors.gray}}>{item.nextTime}</Text>
                </View>
               
                    {  item.disabled ?<View style={styles.viewTopLeft2}>
                        <Text style={styles.textTopLeft2}>{ global.lang.wc240bl_label_disable}</Text>
                    </View>:null}
                    <View style={[styles.viewTopLeft,{ backgroundColor: item.disabled ? 'rgba(0,0,0,0)': 'rgba(0,0,0,0.5)'}]}>
                        <Text style={styles.textTopLeft}>{item.s}</Text>
                    </View>
                    <TouchableOpacity style={{  position: 'absolute', top: 0,right:0,  width: 30,  height: 30,  borderRadius: 13, alignItems: 'center', justifyContent: 'center',  backgroundColor: item.disabled ? 'rgba(0,0,0,0)': 'rgba(0,0,0,0.5)'}} onPress={this.showCardMenu.bind(this,item)}>
                    <Icon style={{color:'white',position: 'absolute', alignItems: 'center', justifyContent: 'center',}} name="dots-horizontal" size={30} ></Icon>
                    </TouchableOpacity>
                   
                </TouchableOpacity>

            )
    }
singleItem = ({item,index}) => {  
            return (

                <TouchableOpacity style={{marginTop:12,marginLeft:18,marginRight:18,height:189,backgroundColor:'white',borderRadius:13}} onPress={this.timingDetail.bind(this,item)}>
                 
                <ImageView style={{height:107, borderTopLeftRadius: 13,borderTopRightRadius:13}} source={{uri:item.photo==null?'garden': global.urlImage+ urls.kUrlImage + item.photo}} placeholderSource={{uri:'garden'}}/>
                <View style={{height:82, borderBottomLeftRadius: 13,borerBottomRightRadius:13,opacity: item.disabled ? 0.5 :1}}>
                <Text style={{marginLeft:13,marginTop:13,fontSize:15,color:constants.colors.darkGray}}>{item.name ?item.name:this.setSiteName(item)}</Text>
                <Text  style={{marginLeft:13,fontSize:13,color:constants.colors.gray}}>{item.nextTime}</Text>
                </View>
                    <View style={[styles.viewTopLeft,{ backgroundColor: 'rgba(0,0,0,0.5)'}]}>
                        <Text style={styles.textTopLeft}>{item.s}</Text>
                    </View>
                    <TouchableOpacity style={{  position: 'absolute', top: 0,right:0,  width: 30,  height: 30,  borderRadius: 13, alignItems: 'center', justifyContent: 'center',  backgroundColor:'rgba(0,0,0,0.5)'}} onPress={this.showCardMenu.bind(this,item)}>
                    <Icon style={{color:'white',position: 'absolute', alignItems: 'center', justifyContent: 'center',}} name="dots-horizontal" size={30} ></Icon>
                    </TouchableOpacity>
                   
                </TouchableOpacity>

            )
    }
    
    render() {
           let numColumn = 1
        let channels = this.props.state.Device.channels
        if(channels>1){
            numColumn = 2
        }
        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />

                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <Header left={true} title={this.props.state.Device.name} back={this.back.bind(this)}>
                    <TouchableHighlight underlayColor='none' style={styles.menuTouch} onPress={this.showMenu}>
                        <Icon style={styles.meunIcon} name="dots-horizontal" size={30} ></Icon>
                    </TouchableHighlight>
                </Header>
                <SafeAreaView style={{ flex: 1, backgroundColor: constants.colors.lightGray }}>
                    <FlatList
                          key={`flatlist_${numColumn}`} // 核心解决：numColumns变化时key随之改变
                            numColumns={numColumn}
                        data={this.state.data}
                        extraData={this.state}
                       renderItem={numColumn==1?this.singleItem:this.listItem}
                        keyExtractor={(item,index)=>index}
                        contentContainerStyle={styles.listViewStyle}
                    />
                </SafeAreaView>

            </View>
        )
    }
}


const styles = StyleSheet.create({

    listViewStyle:{
        flexDirection:'column',
        bottom:10,
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
    viewTopLeft: {
        position: 'absolute',
        // opacity:0.8,
        top: 0,
        width: 26,
        height: 26,
        borderTopLeftRadius: 13,
        borderBottomRightRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)'
    },
    viewTopLeft2: {
        // opacity:0.8,
          position: 'absolute',
        marginTop: 0,
        left:0,
        right:0,
        height: 25,
        borderTopLeftRadius: 13,
        borderTopRightRadius: 13,

        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,0,0,0.5)'
    },
    textTopLeft2: {
        // color: '#fff',
        // position: 'absolute',
        // height: 26,
        fontSize: 13,
        // backgroundColor: 'transparent',
        color: 'white',
        textAlign: 'center',
    },
    textTopLeft: {
        // color: '#fff',
        fontSize: 16,
        // backgroundColor: 'transparent',
        color: 'white',
        textAlign: 'center',
    },
    textStyle: {
        marginLeft: 20,
        marginRight: 17,
        marginBottom: 5,
        fontSize: 10,
        color: constants.colors.darkGray,
        // fontWeight:"bold"
    },
    listFooter:{
        height:120,
        width:'100%',
        flexDirection:'column',
        justifyContent:'center',
        
    },
    syncTime:{
        // width:'100%',
        marginLeft:20,
        marginRight:20,
        marginBottom:5,
        textAlign:'center',
        fontSize:14,
        color:constants.colors.darkGray
    },
    syncButton:{
        height:50,
        marginLeft:20,
        marginRight:20,
        
        borderRadius:25,
    },
    syncButtonText:{
        fontSize:18,
        color:'white',
        alignSelf:'center',
        height:50,
        ...Platform.select({
            android:{textAlignVertical:'center'},
            ios:{lineHeight:50}
        })
    }
})
export default connect((state) => {
    return {
        state
    }
})(SitesScreen)

