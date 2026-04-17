import React from 'react'

import {
    View,
    SafeAreaView,
    StyleSheet,
    StatusBar,
    NativeModules,
    TouchableHighlight,
    Text,
    Dimensions,
    ScrollView,
    BackHandler,
} from 'react-native'
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';

import Header from '../../../common/component/Header';
import Icon from "react-native-vector-icons/MaterialIcons";
import WheelPicker from '../../component/WheelPicker';
import Func from '../../component/Func'

let { width, height } = Dimensions.get('window');

const mqttManager = NativeModules.RCMQTTManager;
class RepeatScreen extends React.Component {
    
    weekArray = [global.lang.wc240bl_mo,
        global.lang.wc240bl_tu,
        global.lang.wc240bl_we,
        global.lang.wc240bl_th,
        global.lang.wc240bl_fr,
        global.lang.wc240bl_sa,
        global.lang.wc240bl_su]
    constructor(props) {
        super(props)
        let program = this.props.route.params
        this.state = {    
            mode : program.parameter.repeat_mode,     
            interval:program.parameter.interval_days,
            even_odd:program.parameter.even_odd,
            weekSelected :Func.commonFunc.parseWeekSelect(program.parameter.weekdays)
        }
        
        this.program = program

        this.routerEventBlur = this.props.navigation.addListener("blur", payload => {//页面失去焦点

            this.backHandler && this.backHandler.remove();

        });
        this.routerEventFocus = this.props.navigation.addListener("focus", payload => {//页面获取焦点
         
            this.backHandler = BackHandler.addEventListener('hardwareBackPress', ()=>{
                this.back()
                return true
            })
        });
        

    }
    
    componentDidMount() {
        this.oldFlag = this.getChangeFlag()
    }

    componentWillUnmount() {
        this.routerEventBlur && this.routerEventBlur()
        this.routerEventFocus && this.routerEventFocus()
    }
    sendToServer(){
      
        let identifier = '03_program_'+(this.program.tag.toLowerCase())+'_parameter'
       
        this.program.parameter.repeat_mode = this.state.mode
        switch(this.state.mode){
            case Func.commonFunc.repeat_mode_week:
                this.program.parameter.weekdays = Func.commonFunc.weekToString(this.state.weekSelected)
                break
            case Func.commonFunc.repeat_mode_interval:
                this.program.parameter.interval_days = this.state.interval
                break
            case Func.commonFunc.repeat_mode_even_odd:
                this.program.parameter.even_odd = this.state.even_odd
                break
        }

        // var dic = {
        //     attrArray:
        //         [
        //             {
        //                 identifier,
        //                 identifierValue: JSON.stringify(this.program.parameter),
        //             },
        //             {
        //                 identifier:Func.wc240bl.last_update_time,
        //                 identifierValue:new Date().getTime()
        //             }
        //         ]
        // }

        // console.log('send:', dic['attrArray']);
        // mqttManager.controlDeviceWithDic((dic))
    }
    back(){
        let newFlag = this.getChangeFlag()
        
        if(this.oldFlag != newFlag){
            //有变动，要保存
            this.sendToServer()
        }
        this.props.navigation.goBack()
    }
    creatWeekView() {
        let data = this.state.weekSelected;
        let useWidth = width - 36
        var itemSize = 40
        var marginLeft = (useWidth - itemSize*data.length)/8
       
        if(marginLeft <= 0){
            //小于等于0时，固定marginleft，动态算itemSize
            marginLeft = 3
            itemSize = (useWidth - marginLeft*8)/7
        }
        return data.map(
            (item, index) => {
                
                return (
                    <TouchableHighlight underlayColor='none' key={index} style={ [item ? styles.selectWeekItem : styles.weekItem,{height:itemSize,width:itemSize,marginLeft}]} onPress={()=>{
                            data[index] = !item
                            this.setState({
                                weekSelected:data
                            })
                        }}>
                        <Text style={item ? styles.selectWeekText : styles.WeekText}>{this.weekArray[index]}</Text>
                    </TouchableHighlight>
                )
            }
        )
    }

    getChangeFlag(){
        var modeStr = this.state.mode+" "
        switch(this.state.mode){
            case Func.commonFunc.repeat_mode_week :
                modeStr += this.state.weekSelected.join('')
                return modeStr
                
            case Func.commonFunc.repeat_mode_interval :
                modeStr += this.state.interval
                return modeStr
                
            case Func.commonFunc.repeat_mode_even_odd :
                modeStr += this.state.even_odd
                return modeStr
        }
        return modeStr
    }

    getModeStr(){
        
        switch(this.state.mode){
            case Func.commonFunc.repeat_mode_week :
                var modeStr = ""
                var allDay = true
                this.state.weekSelected.forEach( (item ,index)=> {
                    if(item){
                        modeStr = modeStr + this.weekArray[index] +" "
                    }else{
                        allDay = false
                    }
                })
                if(allDay){
                    modeStr = global.lang.wc240bl_weekday //+'-'+ global.lang.wc240bl_everyday
                }else{
                    modeStr = global.lang.wc240bl_weekday //+ '-' + modeStr
                }
                return modeStr
                
            case Func.commonFunc.repeat_mode_interval :
                return global.lang.wc240bl_interval_days //+'-'+this.state.interval
                
            case Func.commonFunc.repeat_mode_even_odd :
                return global.lang.wc240bl_even_or_odd //+'-'+ (this.state.even_odd == Func.commonFunc.even_day ? global.lang.wc240bl_even_days : global.lang.wc240bl_odd_days)
        }
        return ''
    }
    showModePickerAlert(){
        let data = [global.lang.wc240bl_weekday,global.lang.wc240bl_interval_days,global.lang.wc240bl_even_or_odd]
        let value = 0
        if(this.state.mode == Func.commonFunc.repeat_mode_week){
            value = 0
        }else if(this.state.mode == Func.commonFunc.repeat_mode_interval){
            value = 1
        }else{
            value = 2
        }
        this.pickerAlert && this.pickerAlert.showDialog(100,data,value)
    }
    showIntervalPickerAlert(){
        let data = Array(61).fill(0).map((_,index)=>{return String(index)})
        let value = Math.min(60, Math.max(this.state.interval,0))
        console.log("日日",data)
        this.pickerAlert && this.pickerAlert.showDialog(200,data,value)
    }
    showEvenOrOddPickerAlert(){
        let data = [global.lang.wc240bl_even_days , global.lang.wc240bl_odd_days]
        let value = 0
        if(this.state.even_odd == Func.commonFunc.even_day){
            value = 0
        }else if(this.state.even_odd == Func.commonFunc.odd_day){
            value = 1
        }
       
        this.pickerAlert && this.pickerAlert.showDialog(300,data,value)
    }
    pickerConfirm(type,value){
        if(type == 100){
            switch(value){
                case 0: this.setState({mode:Func.commonFunc.repeat_mode_week});break
                case 1: this.setState({mode:Func.commonFunc.repeat_mode_interval});break
                case 2: this.setState({mode:Func.commonFunc.repeat_mode_even_odd});break
            }
        }else if(type == 200){
            this.setState({
                interval:value
            })
        }else if(type == 300){
            if(value == 0){
                this.setState({
                    even_odd:Func.commonFunc.even_day
                })
            }else{
                this.setState({
                    even_odd:Func.commonFunc.odd_day
                })
            }
        }

    }
    render() {
        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <Header left={true} title={global.lang.wc240bl_repeat} back={this.back.bind(this)}>
                    
                </Header>
                <SafeAreaView style={{flex:1, backgroundColor: constants.colors.lightGray }}>
                    <WheelPicker
                        ref={(e) => { this.pickerAlert = e }}
                        ok={global.lang.wc240bl_label_cancel}
                        cancel={global.lang.wc240bl_label_save}
                        alertTitle={global.lang.wc240bl_repeat}
                        selectIndex={1}
                        comformClik={
                            this.pickerConfirm.bind(this)
                        }/>
                    <ScrollView>
                        <View style={styles.mainItem}>
                            <TouchableHighlight underlayColor='none' onPress={this.showModePickerAlert.bind(this)} >
                                <View style={styles.item}>
                                    <Text style={styles.itemTitle}>{global.lang.wc240bl_repeat}</Text>
                                    <Text style={styles.itemContent}>{this.getModeStr()}</Text>
                                    <Icon name={'arrow-forward-ios'}  color={constants.colors.gray} size={18}></Icon>
                                </View>
                            </TouchableHighlight>
                        </View>
                        {
                            this.state.mode == Func.commonFunc.repeat_mode_week ? 
                            <View style={[styles.mainItem,{paddingLeft:0,paddingRight:0,marginTop:0, flexDirection:'row'}]}>
                                {this.creatWeekView()}
                            </View>
                            : this.state.mode == Func.commonFunc.repeat_mode_interval ? 
                            <View style={styles.mainItem}>
                                <TouchableHighlight underlayColor='none' onPress={this.showIntervalPickerAlert.bind(this)}>
                                    <View style={styles.item}>
                                        <Text style={styles.itemTitle}>{global.lang.wc240bl_interval_days}</Text>
                                        <Text style={styles.itemContent}>{this.state.interval}</Text>
                                        <Icon name={'arrow-forward-ios'} color={constants.colors.gray} size={18}></Icon>
                                    </View>
                                </TouchableHighlight>
                            </View> : 
                            <View style={styles.mainItem}>
                                <TouchableHighlight underlayColor='none' onPress={this.showEvenOrOddPickerAlert.bind(this)}>
                                    <View style={styles.item}>
                                        <Text style={styles.itemTitle}>{global.lang.wc240bl_even_or_odd}</Text>
                                        <Text style={styles.itemContent}>{this.state.even_odd == Func.commonFunc.even_day ? global.lang.wc240bl_even_days : global.lang.wc240bl_odd_days}</Text>
                                        <Icon name={'arrow-forward-ios'} color={constants.colors.gray} size={18}></Icon>
                                    </View>
                                </TouchableHighlight>
                            </View> 
                        }
                    </ScrollView>
                </SafeAreaView>
                                   
            </View>
        )
    }
}


const styles = StyleSheet.create({

    mainItem:{
        marginTop:12,
        marginBottom:15,
        marginLeft:18,
        marginRight:18,
        padding:20,
        backgroundColor:'white',
        borderRadius:13,
        flexDirection:'column'
    },
    item:{
        width:'100%',
        flexDirection:'row',
        alignItems:'center',
       // backgroundColor:'red'
    },
    itemTitle:{
        fontSize:18,
        color:constants.colors.darkGray,
       // backgroundColor:'blue'
    },
    itemContent:{
        flex:1,
        fontSize:16,
        textAlign:'right',
        marginRight:5,
        color:constants.colors.gray,
        textAlignVertical:'center',
        // backgroundColor:'yellow'
    },
    
   

    weekItem: {
        backgroundColor: constants.colors.lightGray,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 6,
    },
    selectWeekItem: {
        backgroundColor: constants.colors.themeColor,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 6,
    },
    selectWeekText: {
        color: 'white',
    },
    WeekText: {
        color: 'black',
    },
})
export default RepeatScreen