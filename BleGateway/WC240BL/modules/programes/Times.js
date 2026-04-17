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
    findNodeHandle,
    NativeModules,
    TouchableOpacity,
    Dimensions,
    BackHandler
} from 'react-native'
import constants from '../../../common/constants/constants';
import StartTimeScreen from '../../../EB640LC/components/StartTime';
import Header from '../../../common/component/Header';
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import AlertView from "../../../common/component/AlertView";
import commFunc from '../../../common/util/commFunc';
import { menuView } from "../../../common/component/menuView";

let { width, height } = Dimensions.get('window');

const mqttManager = NativeModules.RCMQTTManager;

class TimesScreen extends React.Component {

    constructor(props) {
        super(props)
        let program = this.props.route.params
        this.state = {    
            times:program.times.map(v => {
                return {v, h:parseInt(v/3600),m:parseInt(v%3600/60)}
            }) 
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
    back(){
        let newData = JSON.stringify(this.state.times)
        if(newData != this.oldData){
                //有变动，要保存
            this.sendToServer()
        }
        this.props.navigation.goBack()
    }
    componentDidMount() {
        this.oldData = JSON.stringify(this.state.times)
    }

    componentWillUnmount() {
        this.routerEventBlur && this.routerEventBlur()
        this.routerEventFocus && this.routerEventFocus()
        this.routerEventBlur = null
        this.routerEventFocus = null
    }
    sendToServer(){
        
        let identifier = '03_program_'+(this.program.tag.toLowerCase())+'_times'
        
        let times = []
        this.state.times.forEach(element => {
            times.push(element.v)
        });
      
        times.sort((a,b)=>a-b)
        let originArray = this.program.times
        originArray.splice(0,originArray.length)
        originArray.push(...times)
        console.log('sendToServer',originArray)
        // var dic = {
        //     attrArray:
        //         [
        //             {
        //                 identifier,
        //                 identifierValue: JSON.stringify(times),
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
    showMenu = (e) => {//显示 隐藏 菜单
        const handle = findNodeHandle(e.target);
        NativeModules.UIManager.measure(handle, (x, y, width, height, pageX, pageY) => {
            // console.warn(x, y, width, height, pageX, pageY)
            menuView.show(
                [ global.lang.wc240bl_add],
                (index) => {
                    menuView.hidden()

                    if (index == 0) {
                        if(this.state.times.length >= 30){
                            //不能超过30个
                            commFunc.alert(global.lang.wc240bl_max_times_qty)
                            return
                        }
                        this.timeAlert && this.timeAlert.showDialog(-1,{h:0,m:0})

                    }
                    console.log(index);
                },
                pageY)

        })

    }
    remove(index){
        let times = this.state.times
        if(times.length == 1){
            commFunc.alert(global.lang.wc240bl_at_least_one_time)
            return
        }
        AlertView.show("",
            <Text style={{marginLeft:15,marginRight:15,fontSize:16,textAlign:'center',alignItems: 'center'}}>
            {global.lang.wc240bl_confirm_deletion}
            </Text>,global.lang.wc240bl_label_cancel, global.lang.wc240bl_ok,
                
                () => { AlertView.hidden()  },
                () => {
                    AlertView.hidden()
                    times.splice(index,1)
                    this.setState({
                        times
                    })
                    console.log('remove',index)
                }
        )
        
    }

    timeConfirm(value,tag){
        let h = parseInt(value[0])
        let m = parseInt(value[1])
        
        let times = this.state.times
        if(tag == -1){
            //新增
           
            for(i in times){
                let time = times[i]
                console.log(time,h,m)
                if(time.h === h && time.m === m){
                    //已经有这个时间，不能再添加
                    commFunc.alert(global.lang.wc240bl_time_overlap)
                    return
                }
            }
            times.push({v:(h*3600 + m*60), h,m})
            times.sort((a,b)=>a.v - b.v)
            this.setState({
                times
            })
        }else if(tag >= 0 && tag <times.length){
            //修改
            for(i in times){
                let time = times[i]
                if(i != tag && time.h == h && time.m == m){
                    //已经有这个时间，不能再添加
                    commFunc.alert(global.lang.wc240bl_time_overlap)
                    return
                }
            }
            times[tag] = {v:(h*3600 + m*60), h,m}
            times.sort((a,b)=>a.v - b.v)
            this.setState({
                times
            })
        }
    }

    formatTime(time){
        let h = time.h
        let m = time.m
        if(h < 10){
            h = '0'+h
        }
        if(m < 10){
            m = '0'+m
        }
        return h+':'+m
    }
    programItem = ({item,index}) => {
        return (
            <TouchableWithoutFeedback
                underlayColor='none'
                onPress={()=>{this.timeAlert && this.timeAlert.showDialog(index,item)}}>
                <View style={styles.mainItem}>
                    <Text style={styles.time}>{this.formatTime(item)}</Text>
                    <TouchableOpacity style={styles.x} onPress={this.remove.bind(this,index)}>
                        <Text style={styles.xText}>×</Text>
                    </TouchableOpacity>
                </View>
            </TouchableWithoutFeedback>
        )
    }
    
    render() {
        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <Header left={true} title={global.lang.wc240bl_time} back={this.back.bind(this)}>
                    <View style={{flexDirection:'row'}}>
                        <TouchableHighlight underlayColor='none' style={styles.menuTouch} onPress={this.showMenu}>
                            <Icon style={styles.meunIcon} name="dots-horizontal" size={30} ></Icon>
                        </TouchableHighlight>
                    </View>
                </Header>
                <SafeAreaView style={{flex:1, backgroundColor: constants.colors.lightGray}}>
                    <StartTimeScreen
                        ref={(e) => { this.timeAlert = e }}
                        ok={global.lang.wc240bl_label_cancel}
                        cancel={global.lang.wc240bl_label_save}
                        alertTitle={global.lang.wc240bl_time}
                        subTitle1={global.lang.wc240bl_hour}
                        subTitle2={global.lang.wc240bl_minute}
                        comformClik={
                            this.timeConfirm.bind(this)
                        }/>
                    <FlatList
                        style = {{marginLeft:10,marginRight:10}}
                        numColumns={2}
                        data={this.state.times}
                        renderItem={this.programItem}
                        keyExtractor={(item,index)=>index}
                        key={'times'}/>

                    
                </SafeAreaView>
                                   
            </View>
        )
    }
}


const styles = StyleSheet.create({
    mainItem:{
        margin:10,
        width: (width - 60)/2,
        //flex:1,
        height:70,
        backgroundColor:'white',
        borderRadius:13,
        flexDirection:'row',
       
    },
    time:{
        color:constants.colors.gray,
        fontSize:16,
        flex:1,
        marginLeft:13,
        alignSelf:'center',
        textAlign:'left'
    },
    x:{
        color:constants.colors.gray,
        fontSize:16,
        height:30,
        width:30,
        marginLeft:3,
        alignSelf:'center',
    },
    xText:{
        color:constants.colors.gray,
        fontSize:20,
    },
})
export default TimesScreen