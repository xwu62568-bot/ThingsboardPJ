import React from 'react'

import {
    View,
    SafeAreaView,
    StyleSheet,
    StatusBar,
    FlatList,
    TouchableWithoutFeedback,
    TouchableHighlight,
    Text,
    Switch,
    Platform,
    NativeModules
} from 'react-native'
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';

import Header from '../../../common/component/Header';
import actions from '../../../WV100LR/store/actions/Index';
import Func from '../../component/Func';

const mqttManager = NativeModules.RCMQTTManager;
class ProgramScreen extends React.Component {

    constructor(props) {
        super(props)
        this.showDisable=true,
        this.state = {          
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
       
    }

    componentWillUnmount() {
      
    }

    getSites(howLong){
        let isSiteMaster = this.props.state.Device.site1_mode == Func.commonFunc.site1_master
        let howLongStr = global.lang.wc240bl_site
        howLong.forEach((element,index) => {
            for(key in element){
                if(key == 1 && isSiteMaster){
                    
                }else{
                    howLongStr += key + (index == howLong.length-1 ? '' :',')
                }
            }
        })
        return howLongStr
    }
    switchOnChange(tag,value){
        if(value == false) return
        let current
        if(tag == 'A'){
            current = 1
        }else if(tag == 'B'){
            current = 2
        }else if(tag == 'C'){
            current = 3
        }else{
            current = 4
        }
        this.props.dispatch(actions.Device.updateDevice('current_run_program',current))
        console.log(value,tag)
        var dic = {
            attrArray:[
                {
                    identifier:Func.wc240bl.current_run_program,
                    identifierValue:current
                },
                {
                    identifier:Func.wc240bl.last_update_time,
                    identifierValue:new Date().getTime()
                }
            ]
        }

        console.log('send:', dic['attrArray']);
        mqttManager.controlDeviceWithDic((dic))
    }
    programItem = ({item,index}) => {
        let current = this.props.state.Device.current_run_program
        let checked = false
        if(current == item.s){
            checked = true
        }
        return (
            <TouchableWithoutFeedback
                underlayColor='none'
                onPress={()=>{this.props.navigation.navigate('ProgramEditScreen',item)}}>
                <View style={styles.mainItem}>
                    <Text style={styles.topLeftIndex}>{item.tag}</Text>
                    <View style={styles.middle}>
                        <Text style={{fontSize:16,color:constants.colors.darkGray}} numberOfLines={1}>
                            {Func.commonFunc.getRepeat(item.parameter.repeat_mode)}
                        </Text>
                        <Text style={{fontSize:14,marginTop:3}} numberOfLines={1}>
                            {
                                item.times.map(t => {return Func.commonFunc.formatTime(t)}).join("  ")
                            }
                        </Text>
                        <Text style={{fontSize:14,marginTop:3}} numberOfLines={1}>
                            {this.getSites(item.how_long)}
                        </Text>
                    </View>
                
                    <Switch style={styles.rightSwitch} onValueChange={this.switchOnChange.bind(this,item.tag)} value={checked} />
                </View>
            </TouchableWithoutFeedback>
        )
    }
    listFooterComponent(){
        return (
           <View />
        )
    }
    // formatDate(date){
        
    //     if(date == null || date.length == 0) {
    //         return ''
    //     }else{
    //       var ms = parseInt(date)
    //     }
    //     let utcDate = moment.utc(ms);
    //     let localDate = moment(utcDate).local();

    //     return localDate.format("YYYY/MM/DD HH:mm:ss");
    // }
    canSync(){
        if(global.isConnected != true){
            return false
        }
        let updateTime = this.props.state.Device.last_update_time
        let syncTime = this.props.state.Device.last_sync_time
        if(isNaN(updateTime) || isNaN(syncTime)){
            return true
        }
        return  updateTime > syncTime 
    }
    sync(){
        if(this.props.state.Device.baseType == "wc280bl"){
            this.props.navigation.navigate('PlanListRotationScreen',{})
        }else{
            this.props.navigation.navigate('PlanListScreen',{})
        }
    }
    render() {
        let programs = this.props.state.Device.programs
        
        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <Header left={true} title={global.lang.wc240bl_program} back={this.back.bind(this)}>
                    
                </Header>
                <SafeAreaView style={{flex:1, backgroundColor: constants.colors.lightGray}}>
                    <FlatList
                        ListFooterComponent={this.listFooterComponent()}
                        data={programs}
                        renderItem={this.programItem}
                        keyExtractor={(item,index)=>index}
                        key={'program'}/>

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
        //width:'100%',
        flex:1,
        height:130,
        backgroundColor:'white',
        borderRadius:13,
        flexDirection:'row'
    },
    topLeftIndex:{
        position:'absolute',
        top:0,
        left:0,
        borderTopLeftRadius:13,
        borderBottomRightRadius:13,
        width:30,
        height:30,
        fontSize:18,
        textAlign:'center',
        ...Platform.select({
            android:{textAlignVertical:'center'},
            ios:{lineHeight:30}
        }),
        color:constants.colors.darkGray,
        backgroundColor:'#DDE5EB'
    },
    middle:{
        flexDirection:'column',
        flex:1,
        marginLeft:35,
        marginRight:20,
        alignSelf:'center',
        //backgroundColor:'red'
    },
    rightSwitch:{
       // backgroundColor:'blue',
        marginRight:10,
        height:40,
        width:60,
        alignSelf:'center'
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
    // console.log("device : ",state)
    return {
        state
    }
})(ProgramScreen)