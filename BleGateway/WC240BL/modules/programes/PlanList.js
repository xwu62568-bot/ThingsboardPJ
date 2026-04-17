import React,{PureComponent} from 'react'

import {
    View,
    SafeAreaView,
    StyleSheet,
    StatusBar,
    SectionList,
    TouchableHighlight,
    Text,
    TouchableOpacity,
    Platform,
    Image,
    NativeModules,
    findNodeHandle,
    DeviceEventEmitter,
    NativeEventEmitter
} from 'react-native'
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';
import Storage from '../../../common/util/asyncstorage';
import Header from '../../../common/component/Header';
import Func from '../../component/Func';
import moment from 'moment';
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { loadingView } from "../../../common/component/loadingView";
import { menuView } from "../../../common/component/menuView";
import Command from '../../component/Command';

import bleManager from '../BleManager'
import commFunc from '../../../common/util/commFunc';

const MQTTManagerEvent = NativeModules.MQTTManagerEvent;

const MQTTManagerEventEmitter = new NativeEventEmitter(MQTTManagerEvent);

const mqttManager = NativeModules.RCMQTTManager;


const limitDay = 30 //显示天数
const maxDays = 365//最多后推天数

const blePackageSize = 20//蓝牙每一包数据长度

class PlanListScreen extends React.Component {

    constructor(props) {
        super(props)
        
        let site = this.props.route.params.site 
        this.state = {  
            site:site == null ? 0 : site,   
            isSyncedPlan: site != null,//已经同步过了，只是进来看执行计划的
            planList:[],
            hasTimeOverlap:false,
            showData:[],

        }

        this.routerEvent = this.props.navigation.addListener("blur", payload => {//页面失去焦点

            this.backHandler && this.backHandler.remove();

        });
        this.routerEvent = this.props.navigation.addListener("focus", payload => {//页面获取焦点
         
        
        });

    }
    back(){
        this.props.navigation.goBack()
    }
    componentDidMount() {
        if(this.state.isSyncedPlan){
            this.readSyncSnapShot(()=>{
                this.initData()
            })
        }else{
            this.initData()
        }
        //蓝牙监听
        this.bleListener = DeviceEventEmitter.addListener('bleListener', (data) => {
            loadingView.hidden()
            console.log( "planList receive data",data)//7b ca 00 0a 01 10 41 01 05 38
            if(data.code==-1){

            }else{
                // this.buffer__ = this.buffer__.concat(data.buff)
                var buffer = data.buff
                console.log( "planList receive data",Command.hexToString(data.buff))//7b ca 00 0a 01 10 41 01 05 38
                //校验crc
                if(Command.CRCCalc(buffer,buffer.length) == 0){
                    console.log( "planList receive data 校验成功",Command.hexToString(buffer))//7b ca 00 0a 01 10 41 01 05 38
                    //判断messageId
                    let backMsgId = buffer[4]
                    if(this.messageId == backMsgId){
                        var result = buffer[5]
                        if(result == 0){
                            //成功
                            //修改最后同步时间
                            var dic = {
                                attrArray:[
                                    {
                                        identifier:Func.wc240bl.last_sync_time,
                                        identifierValue:new Date().getTime()
                                    }
                                ]
                            }
                            console.log('send:', dic['attrArray']);
                            mqttManager.controlDeviceWithDic((dic))

                            return
                        }
                        this.syncFail()
                    }
                }else{
                    //校验crc失败
                    console.log( "planList receive data 校验失败",Command.hexToString(buffer))//7b ca 00 0a 01 10 41 01 05 38
                }
                
            }
        })
        if (this.controlSubscription == null) {
            this.controlSubscription = MQTTManagerEventEmitter.addListener(
                'KMqttControl',
                (control) => {
                    // let valveStatus = -1;
                    this.handleData(control)
                },

            );
        }
    } 
    handleData(control) {
        console.log('receive:', control)
        if(control.code != 200){
            //出现错误
            return
        }
        let syncIsBack = false
        for (let index = 0; index < control.deviceAttrList.length; index++) {
            let item = control.deviceAttrList[index];
            if(item.identifier == null || item.identifierValue == null){
              continue
            }
            if(item.identifier == Func.wc240bl.last_sync_time){
                syncIsBack = true
            }
        }
        if(syncIsBack){
            this.syncSuccess()
        }
    }
    componentWillUnmount() {
        this.bleListener&& this.bleListener.remove()
        this.controlSubscription && this.controlSubscription.remove();
        this.controlSubscription = null;
    }

    initData(){
        let planList = []
        var program = this.getProgram()
        if(program == null){
            return
        }
        this.program = program
        
        let parameter = program.parameter

        let times = program.times.map(v => {
            return {v , h: parseInt(v/3600),m:parseInt(v%3600/60)}
        })
        let seasonDiffOn = parameter.season_differ_on_off == 'true'
   
        //周循环模式下 取消跳过周几 
         let skip_days = parameter.skip_days 
              if(parameter.repeat_mode == Func.commonFunc.repeat_mode_week){
                  skip_days  = '0000000'
              }

        let skipDays = this.weekDaysToArray(skip_days)

        for(i in program.how_long){
            const element = program.how_long[i]
            let site = Object.keys(element)[0]
            let howLong = element[site]
            if( !(site == 1 && this.getSite1Mode() == Func.commonFunc.site1_master)){
            // if(this.state.site != null && this.state.site == site){
            //     //显示某一个站点
            //     planList.push(...this.calcOneSite(parameter,site,times,howLong,seasonDiffOn,skipDays))

            //     //退出循环
            //     break
            // }
            // if(this.state.site == null){
                //显示全部
                planList.push(...this.calcOneSite(parameter,site,times,howLong,seasonDiffOn,skipDays))
            // }
            }
        }
        this.state.planList = planList
        this.grouping()
    }
    calcOneSite(parameter,site,times,howLong,seasonDiffOn,skipDays){
        switch(parameter.repeat_mode){
            case Func.commonFunc.repeat_mode_even_odd:
                let isEven = parameter.even_odd == Func.commonFunc.even_day
                return this.calcEvenOddMode(site,isEven,times,howLong,seasonDiffOn,skipDays)
            case Func.commonFunc.repeat_mode_week:
                let weekDays = this.weekDaysToArray(parameter.weekdays)
                return this.calcWeekDayMode(site,weekDays,times,howLong,seasonDiffOn,skipDays)
            case Func.commonFunc.repeat_mode_interval:
                let interval = parameter.interval_days
                return this.calcIntervalMode(site,interval,times,howLong,seasonDiffOn,skipDays)
        }
        return []
    }
     /**
     * @param site 站点
     * @param weekDays 要开阀的周几[0,1,2,3,4...6] 周日到周六
     * @param formatedTimes  开阀时间 一定是从小到大排列
     * @param howLong 开阀时长
     * @param seasonDiffOn 季节调整是否打开
     * @param skipDays 跳过周几 [ 6,0] 周六 周日
     */
     calcWeekDayMode(site,weekDays,formatedTimes,howLong,seasonDiffOn,skipDays){
        let planList = []
        console.log(weekDays,formatedTimes,howLong,skipDays)
        if(weekDays.length == 0) {
            return planList
        }
        let startMoment = moment(new Date())
        
        let startMilliseconds = startMoment.valueOf()//毫秒值        
        let nowMilliseconds = startMilliseconds//计算第一天用的,
        
        let lastEndMillisecond = 0//记录上一次结束时的毫秒值
        
        let dayCount = 0
        let endMoment = moment(startMoment).add(maxDays,'day')//10 天
        while(dayCount <= limitDay && startMilliseconds <= endMoment.valueOf()){
           
            let weekday = startMoment.weekday()
            if(skipDays.indexOf(weekday) == -1 && weekDays.indexOf(weekday) >= 0){
                dayCount++
                let adjustedHowLong = howLong
                if(seasonDiffOn){
                    adjustedHowLong = this.seasonAdjust(startMoment.month(),howLong)
                }
                formatedTimes.forEach(time => {
                    startMoment.set('hour',time.h)
                    startMoment.set('minute',time.m)
                    
                    const millisecond = startMoment.valueOf()
                    if(millisecond > nowMilliseconds){
                        planList.push({
                            site,
                            date:startMoment.format('YYYY-MM-DD'),
                            startTime:time,
                            howLong:adjustedHowLong,
                            timeOverlap: lastEndMillisecond > millisecond,
                        })
                    }
                    startMoment.add(adjustedHowLong,'second')
                    lastEndMillisecond = startMoment.valueOf()
                    if(time.v + adjustedHowLong > (24*3600 - 1)){
                        //进入后一天，需要回到当天
                        startMoment.add(-1,'day')
                    }
                })
            }
            
            //天数加1
            startMoment.add(1,'day')
            //需要重置
            // startMoment.set('hour',0)
            // startMoment.set('minute',0)
            // startMoment.set('second',0)
           
            startMilliseconds = startMoment.valueOf()
            //console.log('while',startMoment.date())
        }
        return planList
    }
    /**
     * @param site 站点
     * @param interval 间隔天数
     * @param formatedTimes  开阀时间 一定是从小到大排列
     * @param howLong 开阀时长
     * @param seasonDiffOn 季节调整是否打开
     * @param skipDays 跳过周几 [ 6,0] 周六 周日
     */
    calcIntervalMode(site,interval,formatedTimes,howLong,seasonDiffOn,skipDays){
        if(interval < 0) return []

        let planList = []
        console.log(interval,formatedTimes,howLong,skipDays)
        let startMoment = moment(new Date())

        let startMilliseconds = startMoment.valueOf()//毫秒值        
        let nowMilliseconds = startMilliseconds//计算第一天用的,
        let lastEndMillisecond = 0//记录上一次结束时的毫秒值
        let dayCount = 0
        let endMoment = moment(startMoment).add(maxDays,'day')//10 天

        if(this.state.isSyncedPlan){
            let syncTime = this.props.state.Device.last_sync_time
            if(!isNaN(syncTime)){
                let h = startMoment.get('hour')
                let m = startMoment.get('minute')
                let s = startMoment.get('second')
                let ss = startMoment.get('millisecond')
                startMoment = moment(syncTime)
                startMoment.set('hour',h)
                startMoment.set('minute',m)
                startMoment.set('second',s)
                startMoment.set('millisecond',ss) //将时分秒毫秒设置的和当前一样
                startMilliseconds = startMoment.valueOf()//毫秒值
            }
        }

        while(dayCount <= limitDay && startMilliseconds <= endMoment.valueOf()){
            let weekday = startMoment.weekday()
            if(skipDays.indexOf(weekday) == -1 && startMilliseconds >= nowMilliseconds){
                dayCount++
                let adjustedHowLong = howLong
                if(seasonDiffOn){
                    adjustedHowLong = this.seasonAdjust(startMoment.month(),howLong)
                }
                formatedTimes.forEach(time => {
                    startMoment.set('hour',time.h)
                    startMoment.set('minute',time.m)
                    
                    const millisecond = startMoment.valueOf()
                    if(millisecond > nowMilliseconds){
                        planList.push({
                            site,
                            date:startMoment.format('YYYY-MM-DD'),
                            startTime:time,
                            howLong:adjustedHowLong,
                            timeOverlap: lastEndMillisecond > millisecond,
                        })
                    }
                    startMoment.add(adjustedHowLong,'second')
                    lastEndMillisecond = startMoment.valueOf()
                    if(time.v + adjustedHowLong > (24*3600 - 1)){
                        //进入后一天，需要回到当天
                        startMoment.add(-1,'day')
                    }
                })
            }
            //天数加1
            startMoment.add(1+interval,'day')
            //需要重置
            // startMoment.set('hour',0)
            // startMoment.set('minute',0)
            // startMoment.set('second',0)
           
            startMilliseconds = startMoment.valueOf()
           // console.log('while',startMoment.date())
        }
        return planList
    }
    /**
     * @param site 站点
     * @param isEven 是否是偶数天
     * @param formatedTimes  开阀时间 一定是从小到大排列
     * @param howLong 开阀时长
     * @param seasonDiffOn 季节调整是否打开
     * @param skipDays 跳过周几 [ 6,0] 周六 周日
     */
    calcEvenOddMode(site,isEven,formatedTimes,howLong,seasonDiffOn,skipDays){
        let planList = []
        console.log(isEven,formatedTimes,howLong,skipDays)
        let startMoment = moment(new Date())
        
        let startMilliseconds = startMoment.valueOf()//毫秒值        
        let nowMilliseconds = startMilliseconds//计算第一天用的,
        let lastEndMillisecond = 0//记录上一次结束时的毫秒值
        let dayCount = 0   
        let endMoment = moment(startMoment).add(maxDays,'day')//10 天
        while(dayCount <= limitDay && startMilliseconds <= endMoment.valueOf()){
            let date = startMoment.date()
            let weekday = startMoment.weekday()
            if(skipDays.indexOf(weekday) == -1 && date % 2 == (isEven ? 0 : 1)){
                dayCount++
                let adjustedHowLong = howLong
                if(seasonDiffOn){
                    adjustedHowLong = this.seasonAdjust(startMoment.month(),howLong)
                }
                formatedTimes.forEach(time => {
                    startMoment.set('hour',time.h)
                    startMoment.set('minute',time.m)
                    
                    const millisecond = startMoment.valueOf()
                    if(millisecond > nowMilliseconds){
                        planList.push({
                            site,
                            date:startMoment.format('YYYY-MM-DD'),
                            startTime:time,
                            howLong:adjustedHowLong,
                            timeOverlap: lastEndMillisecond > millisecond,
                        })
                    }
                    startMoment.add(adjustedHowLong,'second')
                    lastEndMillisecond = startMoment.valueOf()
                    if(time.v + adjustedHowLong > (24 * 3600 - 1)){
                        //进入后一天，需要回到当天
                        startMoment.add(-1,'day')
                    }
                })
            }
            //天数加1  
            startMoment.add(1,'day')
            //需要重置
            // startMoment.set('hour',0)
            // startMoment.set('minute',0)
            // startMoment.set('second',0)
            
            startMilliseconds = startMoment.valueOf()
           // console.log('while',startMoment.date())
        }
        return planList
    }

    /**
     * @param weekDayStr '1010100' 从周一开始排
     * @returns weekArray [0,1,2...6] 从周日到周六
     */
    weekDaysToArray(weekDayStr){
        let weekArray = []
        if(weekDayStr != null && weekDayStr.length == 7){
            for(i=0; i<7; i++){
                let char =  weekDayStr.charAt(i)
                if(char == '1'){
                    if(i == 6){
                        weekArray.push(0)
                    }else{
                        weekArray.push(i+1)
                    }
                }
            }
        }
        return weekArray
    }
    seasonAdjust(month,howLong){
        let adjustMode = this.getSeasonMode()//{"0":"全部","1":"按月"}
        let diff = 0 // 百分制 带正负
        if(adjustMode == 0){
            if(!isNaN(this.getSeasonAll())){
                diff = this.getSeasonAll()
            }
        }else{
            //按月
            let adjustArray = JSON.parse(this.getSeasonMonth())
            if(adjustArray.length == 12){
                if(!isNaN(adjustArray[month])){
                    diff = adjustArray[month]
                }
            }
        }
        return howLong + parseInt(howLong * diff / 100)
    }
    getCurrentPragram(){
        let current = this.props.state.Device.current_run_program

        let programs = this.props.state.Device.programs
        for( i in programs){
            const p = programs[i]
            if(p.s == current){
                return p
            }
        }
    }
    
    grouping(){
        let hasTimeOverlap = false
        let groupData = this.state.planList.reduce((result, currentItem) => {

            if(currentItem.timeOverlap){
                hasTimeOverlap = true
            }
            if(this.state.site != 0 && this.state.site != currentItem.site){
                //不是显示全部站点，且 不是选中的站点，则返回
                return result
            }

            const groupKey = currentItem['date']
            if(!result[groupKey]){
                result[groupKey] = {
                    items:[],
                    total:0
                }
            }
            result[groupKey]['items'].push(currentItem)
            result[groupKey]['total'] += currentItem.howLong
            
            return result
        },{})
        let showData = []
        let keys = Object.keys(groupData)
        keys.forEach(key => {
            showData.push({
                title:key,
                isShow:true,
                total:groupData[key].total,
                data:groupData[key].items,
            })
        })
        this.setState({
            showData,
            hasTimeOverlap
        })
        //console.log('grouping',showData)
    }
    showHiden = (info) => {

        this.state.showData.forEach((item, index) => {
            if (item === info.section) {
                item.isShow = !item.isShow;
            }
        })

       
        this.setState({})
    }
    showMenu = (e) => {//显示 隐藏 菜单
        const handle = findNodeHandle(e.target);
        NativeModules.UIManager.measure(handle, (x, y, width, height, pageX, pageY) => {
            // console.warn(x, y, width, height, pageX, pageY)
            let menu = [global.lang.wc240bl_adjust_all]

            let program = this.getProgram()
            if(program == null) return
            for(i in program.how_long){
                const element = program.how_long[i]
                let site = Object.keys(element)[0]
                if( !(site == 1 && this.getSite1Mode() == Func.commonFunc.site1_master)){
                    menu.push(global.lang.wc240bl_site+site)
                }
            }

            menuView.show(menu,
                (index) => {
                    menuView.hidden()
                    const text = menu[index]
                    if(text == global.lang.wc240bl_adjust_all){
                        this.state.site = 0
                    }else if(text == global.lang.wc240bl_site+1){
                        this.state.site = 1
                    }else if(text == global.lang.wc240bl_site+2){
                        this.state.site = 2
                    }else if(text == global.lang.wc240bl_site+3){
                        this.state.site = 3
                    }else if(text == global.lang.wc240bl_site+4){
                        this.state.site = 4
                    }
                    this.grouping()
                    this.setState({
                    })

                    console.log(index);
                },
                pageY)
        })

    }
    sectionHeaderComponent = (item) => {
        return (
            <TouchableOpacity style={{ height: 35,marginLeft:25,marginRight:25, justifyContent: 'center',alignItems:'center', flexDirection:'row', backgroundColor: constants.colors.lightGray }} onPress={this.showHiden.bind(this, item)}>
                <Text
                    style={{flex:1, color:constants.colors.darkGray, fontSize: 15 }}>{item.section.title}
                </Text>
                <Text
                    style={{color:constants.colors.darkGray, fontSize: 15,marginRight:20 }}>{Func.commonFunc.formatTime(item.section.total,true)}
                </Text>
                <Image style={{ position: 'absolute', width: 13, height: 13, right: 0, resizeMode: 'contain' }} source={{ uri:item.section.isShow ? 'show' : 'hiden' }} />
            </TouchableOpacity>

        )
    }
    listItem (section,item,index){
        if(!section.isShow) return null

        return (
            <CellComponent index={index} item={item} dataCount={section.data.length} />
        )
    }

    compareTime(){
        let updateTime = this.props.state.Device.last_update_time
        let syncTime = this.props.state.Device.last_sync_time
        if(isNaN(updateTime) || isNaN(syncTime)){
            return true
        }
        return  updateTime > syncTime 
    }
    canSync(){
        var f = !this.state.hasTimeOverlap && this.compareTime()
        if(!f){
            return false
        }else{
            let program = this.getProgram()
            if(program == null) return false
            var flag = false
            for(i in program.how_long){
                const element = program.how_long[i]
                let site = Object.keys(element)[0]
                if( !(site == 1 && this.getSite1Mode() == Func.commonFunc.site1_master)){
                    flag = true
                }
            }
            return flag
        }
    }
    sync(){
        if(global.isConnected != true){
            commFunc.alert(global.lang.wc240bl_cant_operate_without_ble)
            return
        }
        this.showLoading()
        var commandArray = Command.sync(this.props.state.Device)
        if(commandArray == -1){
            this.syncFail()
            loadingView.hidden()
            return
        }
        this.messageId = global.messageId
        if(commandArray.length > blePackageSize){
            //分段发
            let index = 0
            this.sendInterval = setInterval(()=>{
                if(index >= commandArray.length){
                    clearInterval(this.sendInterval)
                    return
                }

                let sliced = commandArray.slice(index,index+blePackageSize)
                index+=blePackageSize
                
                console.log('sliced',Command.hexToString(sliced))
                bleManager.BleWrite(sliced ,(data) => {
                    console.log('蓝牙数据返回===', data)
                }, (err) => {
                    console.log('写入失败===', err)
                })
                
            },100)
        }else{
            bleManager.BleWrite(commandArray, (data) => {
                console.log('蓝牙数据返回===', data)
            }, (err) => {
                console.log('写入失败===', err)
            })
        }
    }
    getProgram(){
        if(this.state.isSyncedPlan){
            if(this.snapShot != null){
                return this.snapShot.program
            }
        }else{
            return this.getCurrentPragram()
        } 
    }
    //获取站点1 模式
    getSite1Mode(){
        if(this.state.isSyncedPlan){
            return this.snapShot.site1_mode
        }else{
            return this.props.state.Device.site1_mode
        }
    }
    getSeasonMode(){
        if(this.state.isSyncedPlan){
            return this.snapShot.season_adjust_mode
        }else{
            return this.props.state.Device.season_adjust_mode
        }
    }
    getSeasonAll(){
        if(this.state.isSyncedPlan){
            return this.snapShot.season_adjust_all
        }else{
            return this.props.state.Device.season_adjust_all
        }
    }
    getSeasonMonth(){
        if(this.state.isSyncedPlan){
            return this.snapShot.season_adjust_month
        }else{
            return this.props.state.Device.season_adjust_month
        }
    }
    readSyncSnapShot(success){
        Storage.get("syncSnapShot"+this.props.state.Device.serialNumber).then((result) => {
            if(result!=null){
                this.snapShot = result
                success()
            }
        }).catch((err) => {
            console.log('readFile failure :' + err.message)
        })
    }
    syncSuccess(){
        commFunc.alert(global.lang.wc240bl_sync_success)
        //将同步成功的程序保存到本地
        var syncSnapShot = {
            program:this.program,
            site1_mode:this.props.state.Device.site1_mode,
            season_adjust_mode:this.props.state.Device.season_adjust_mode,
            season_adjust_all:this.props.state.Device.season_adjust_all,
            season_adjust_month:this.props.state.Device.season_adjust_month
        }
        Storage.save("syncSnapShot"+this.props.state.Device.serialNumber, syncSnapShot)
        .then((success) => {
            console.log('save syncSnapShot', success)
        })
        .catch((err) => {
            console.log('syncSnapShot save failure :' + err.message)
        })

    }
    syncFail(){
        commFunc.alert(global.lang.wc240bl_sync_fail)
        //其他逻辑
    }
    showLoading(){
        loadingView.show()
        setTimeout(()=>{
            loadingView.hidden()
        },15000)
    }
    listEmptyComponent(){
        return (<Text style={styles.emptyStyle}>{this.state.isSyncedPlan ? global.lang.wc240bl_no_timer_list : global.lang.wc240bl_no_conflict_plan}</Text>)
    }
    render() {
               
        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <Header left={true} title={global.lang.wc240bl_plan_list} back={this.back.bind(this)}>
                    {
                        this.props.state.Device.channels > 1 ?
                        <TouchableHighlight underlayColor='none' style={styles.menuTouch} onPress={this.showMenu}>
                            <Icon style={styles.meunIcon} name="dots-horizontal" size={30} ></Icon>
                        </TouchableHighlight>:null
                    }
                    
                </Header>
                <SafeAreaView style={{flex:1, backgroundColor: constants.colors.lightGray}}>
                    <SectionList
                        extraData={this.state}
                        sections={this.state.showData}
                        ListEmptyComponent={this.listEmptyComponent()}
                        renderSectionHeader={this.sectionHeaderComponent}
                        renderItem={({ section,item, index }) => this.listItem(section,item, index)}
                        keyExtractor={(item,index)=>index}
                        key={'program'}/>
                    {
                        this.state.isSyncedPlan ? null 
                        :
                        <View style={styles.listFooter}>
                            <Text style={styles.syncTime}>{global.lang.wc240bl_take_effect_after_synchronization}</Text>
                            <TouchableHighlight
                                underlayColor='none' 
                                disabled={!this.canSync()} 
                                activeOpacity={0.4} 
                                onPress={this.sync.bind(this)} 
                                style={[styles.syncButton,{ backgroundColor:this.canSync() ? constants.colors.themeColor : constants.colors.gray,}]} >
                                <Text style={styles.syncButtonText}>{global.lang.wc240bl_sync_to_device}</Text>
                            </TouchableHighlight>
                        </View>
                    }
                    
                </SafeAreaView>
                                   
            </View>
        )
    }
}
class CellComponent extends PureComponent {
    
    render() {
        return (
            <TouchableOpacity
                style={{flexDirection:'column',flex:1}}
                underlayColor='none'>
                <View style={[styles.mainItem,this.props.index ==0 ? styles.mainItemTopRound : null,this.props.index ==this.props.dataCount-1 ? styles.mainItemBottomRound : null]}>
                    <Text style={styles.text}>{global.lang.wc240bl_site + this.props.item.site}</Text>
                    
                    <Text style={styles.text} numberOfLines={1}>
                        {Func.commonFunc.formatTime(this.props.item.startTime.v)}
                    </Text>
                    <Text style={styles.text} numberOfLines={1}>
                        {Func.commonFunc.formatTime(this.props.item.howLong,true)}
                    </Text>
                    
                    <Text style={[styles.text,{color:'red'}]} numberOfLines={1}>
                        { this.props.item.timeOverlap ? global.lang.wc240bl_time_overlap : ""}
                    </Text>
                </View>
                {
                    (this.props.index !=this.props.dataCount-1)  ? <View style={{height:1,width:100,marginLeft:140,marginRight:40, backgroundColor:constants.colors.lightGray}}/> : null
                }
            </TouchableOpacity>

        )
    }
}
const styles = StyleSheet.create({
    mainItem:{
        marginLeft:18,
        marginRight:18,
        justifyContent: 'center',
        alignItems:'center',
        flex:1,
        height:40,
        backgroundColor:'white',
        flexDirection:'row'
    },
    mainItemTopRound:{
        borderTopRightRadius:13,
        borderTopLeftRadius:13,
    },

    mainItemBottomRound:{
        borderBottomRightRadius:13,
        borderBottomLeftRadius:13,
    },
    text:{
        flex:1,
        height:30,
        fontSize:14,
        textAlign:'center',
        ...Platform.select({
            android:{textAlignVertical:'center'},
            ios:{lineHeight:30}
        }),
        color:constants.colors.darkGray,
    },
    emptyStyle:{
        height:200,
        width:'100%',
        paddingHorizontal:15,
        textAlign:'center',
        textAlignVertical:'center',
    },
    listFooter:{
        height:120,
        width:'100%',
        flexDirection:'column',
        justifyContent:'center',
        
    },
    syncTime:{
       
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
    // console.log("device : ",state)
    return {
        state
    }
})(PlanListScreen)