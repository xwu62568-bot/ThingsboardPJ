import React from 'react'

import {
    View,
    SafeAreaView,
    StyleSheet,
    StatusBar,
    TouchableHighlight,
    Text,
    Switch,
    Dimensions,
    NativeModules,
    ScrollView,
    BackHandler,
} from 'react-native'
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';
import AlertView from "../../../common/component/AlertView";
import Header from '../../../common/component/Header';
import Icon from "react-native-vector-icons/MaterialIcons";
import Func from "../../component/Func"
let { width, height } = Dimensions.get('window');

const mqttManager = NativeModules.RCMQTTManager;

class ProgramEditScreen extends React.Component {
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
            program:program,
            weekSelected :Func.commonFunc.parseWeekSelect(program.parameter.skip_days)
        }
       
        this.routerEventBlur = this.props.navigation.addListener("blur", payload => {//页面失去焦点

            this.backHandler && this.backHandler.remove();

        });
        this.routerEventFocus = this.props.navigation.addListener("focus", payload => {//页面获取焦点
         
            this.backHandler = BackHandler.addEventListener('hardwareBackPress', ()=>{
                this.back()
                return true
            })
            this.setState({})
        });
       
    }

    
    componentDidMount() {
        this.oldParam = JSON.stringify(this.state.program.parameter)
        this.oldTimes = JSON.stringify(this.state.program.times)
        this.oldHowLong = JSON.stringify(this.state.program.how_long)
        console.log("edit","componentDidMount",this.oldTimes)
       
    }

    componentWillUnmount() {
        this.routerEventBlur && this.routerEventBlur()
        this.routerEventFocus && this.routerEventFocus()
    }
    back(){
        //跳过周几
        this.state.program.parameter.skip_days = Func.commonFunc.weekToString(this.state.weekSelected)
        
        
        this.sendToServer()
        this.props.navigation.goBack()
    }
    sendToServer(){
        let newParam = JSON.stringify(this.state.program.parameter)
        let newTimes = JSON.stringify(this.state.program.times)
        let newHowLong = JSON.stringify(this.state.program.how_long)
        console.log("sendToServer",newTimes)
        var attrArray = []
        if(newParam != this.oldParam){
            let identifier = '03_program_'+(this.state.program.tag.toLowerCase())+'_parameter'
            attrArray.push({
                    identifier,
                    identifierValue: newParam,
                })
        }
        if(newTimes != this.oldTimes){
            let identifier = '03_program_'+(this.state.program.tag.toLowerCase())+'_times'
            attrArray.push({
                identifier,
                identifierValue: newTimes,
            })
        }
        if(newHowLong != this.oldHowLong){
            let identifier =  '03_program_'+(this.state.program.tag.toLowerCase())+'_site_how_long'
            attrArray.push({
                    identifier,
                    identifierValue: newHowLong,
                })
        }
        if(attrArray.length > 0){
            attrArray.push({
                identifier:Func.wc240bl.last_update_time,
                identifierValue:new Date().getTime()
            })
            var dic = {
                attrArray
            }
    
            console.log('send:', dic['attrArray']);
            mqttManager.controlDeviceWithDic((dic))
        }
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
    toRepeat(){
        this.props.navigation.navigate('RepeatScreen',this.state.program)
    }
    toTimes(){
        this.props.navigation.navigate('TimesScreen',this.state.program)
    }
    toHowLong(){
        this.props.navigation.navigate('HowLongScreen',this.state.program)
    }
    ecOnValueChange(value){
        if(!value){
            this.state.program.parameter.ec_on_off = 'false'
            this.setState({})
            return
        }
        AlertView.show("",
            <Text style={{marginLeft:15,marginRight:15,fontSize:16,textAlign:'center',alignItems: 'center'}}>
            {global.lang.wc240bl_ec_enabled}
            </Text>,global.lang.wc240bl_label_cancel, global.lang.wc240bl_ok,
                
                () => { AlertView.hidden()  },
                () => {
                    AlertView.hidden()
                    this.state.program.parameter.ec_on_off = 'true'
                    this.setState({})
                }
        )
    }
    seasonOnValueChange(value){
        if(!value){
            this.state.program.parameter.season_differ_on_off = 'false'
            this.setState({})
            return
        }
        AlertView.show("",
            <Text style={{marginLeft:15,marginRight:15,fontSize:16,textAlign:'center',alignItems: 'center'}}>
            {global.lang.wc240bl_seasonal_change_enabled}
            </Text>,global.lang.wc240bl_label_cancel, global.lang.wc240bl_ok,
                
                () => { AlertView.hidden()  },
                () => {
                    AlertView.hidden()
                    this.state.program.parameter.season_differ_on_off = 'true'
                    this.setState({})
                }
        )
        
    }
    render() {
        const hideSkipDays = this.state.program.parameter.repeat_mode == Func.commonFunc.repeat_mode_week
        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <Header left={true} title={global.lang['wc240bl_program_'+(this.state.program.tag).toLocaleLowerCase()]} back={this.back.bind(this)}>
                    
                </Header>
                <SafeAreaView style={{flex:1, backgroundColor: constants.colors.lightGray }}>
                    <ScrollView>
                        <View style={styles.mainItem}>
                            <TouchableHighlight underlayColor='none' style={styles.item} onPress={this.toRepeat.bind(this)}>
                                <View>
                                    <Text style={styles.itemTitle}>{global.lang.wc240bl_repeat}</Text>
                                    <Icon name={'arrow-forward-ios'} size={18} style={styles.arrowStyle}></Icon>
                                    <Text style={styles.itemContent}>{Func.commonFunc.getRepeat(this.state.program.parameter.repeat_mode)}</Text>
                                    <View style={styles.itemLine}/>
                                </View>
                            </TouchableHighlight>

                            <TouchableHighlight underlayColor='none' style={styles.item} onPress={this.toTimes.bind(this)}>
                                <View>
                                    <Text style={[styles.itemTitle,{marginTop:15}]}>{global.lang.wc240bl_time}</Text>
                                    <Icon name={'arrow-forward-ios'} size={18} style={[styles.arrowStyle,{top:20}]}></Icon>
                                    <Text style={styles.itemContent}>
                                        {
                                            this.state.program.times.map(t => {return Func.commonFunc.formatTime(t)}).join("  ")
                                        }
                                    </Text>
                                    <View style={styles.itemLine}/>
                                </View>
                            </TouchableHighlight>
                            
                            <TouchableHighlight underlayColor='none' style={styles.item} onPress={this.toHowLong.bind(this)}>
                                <View>
                                    <Text style={[styles.itemTitle,{marginTop:15}]}>{global.lang.wc240bl_how_long}</Text>
                                    <Icon name={'arrow-forward-ios'} size={18} style={[styles.arrowStyle,{top:20}]}></Icon>
                                    <Text style={styles.itemContent}>
                                        {
                                            this.state.program.how_long.map(v => {
                                                for(key in v){
                                                    if(!(key == 1 && this.props.state.Device.site1_mode == Func.commonFunc.site1_master)){
                                                        return global.lang.wc240bl_site +key + '-' + Func.commonFunc.formatTime(v[key],true)
                                                    }
                                                }
                                                return ""
                                            }).join("  ").trim()
                                        }
                                    </Text>
                                </View>
                            </TouchableHighlight>
                        </View>
                        
                        {
                            hideSkipDays ? null :
                            <>
                                <Text style={{fontSize:18,color:constants.colors.gray,marginLeft:38,marginTop:15,marginBottom:15}}>{global.lang.wc240bl_skip_days}</Text>
                                <View style={[styles.mainItem,{paddingLeft:0,paddingRight:0,marginTop:0, flexDirection:'row'}]}>
                                    {this.creatWeekView()}
                                </View>
                            </>
                        }

                        <View style={[styles.mainItem,{flexDirection:'row'}]}>
                            <Text style={{fontSize:18, flex:1}}>{global.lang.wc240bl_ec}</Text>
                            <Switch onValueChange={this.ecOnValueChange.bind(this)} value={this.state.program.parameter.ec_on_off == 'true'}/>
                        </View>

                        <View style={[styles.mainItem,{flexDirection:'row',marginBottom:12}]}>
                            <Text style={{fontSize:18,flex:1}}>{global.lang.wc240bl_season_adjust}</Text>
                            <Switch onValueChange={this.seasonOnValueChange.bind(this)} value={this.state.program.parameter.season_differ_on_off == 'true'}/>
                        </View>
                    </ScrollView>
                </SafeAreaView>
                                   
            </View>
        )
    }
}


const styles = StyleSheet.create({

    mainItem:{
        marginTop:12,
        marginLeft:18,
        marginRight:18,
        padding:20,
        backgroundColor:'white',
        borderRadius:13,
        flexDirection:'column'
    },
    item:{
        width:'100%',
        flexDirection:'column',

    },
    itemTitle:{
        fontSize:18,
        width:'100%',
        color:constants.colors.darkGray,
    },
    itemContent:{
        width:'100%',
        fontSize:14,
        marginTop:15,
        color:constants.colors.gray,
    },
    itemLine:{
      backgroundColor:constants.colors.lightGray,
      height:1,
      width:'100%',
      marginTop:15,
    
    },
    arrowStyle: {
        position: 'absolute',
        top:5,
        right:0,
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
export default connect((state) => {
    console.log("device : ",state)
    return {
        state
    }
})(ProgramEditScreen)
