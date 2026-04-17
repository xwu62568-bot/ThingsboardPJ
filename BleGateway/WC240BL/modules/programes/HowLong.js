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
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';
import DurationScreen from '../../../WV100LR/components/Duration';
import Header from '../../../common/component/Header';
import AlertView from '../../../common/component/AlertView';
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import commFunc from '../../../common/util/commFunc';
import { menuView } from "../../../common/component/menuView";
import Func from '../../component/Func';

let { width, height } = Dimensions.get('window');

const mqttManager = NativeModules.RCMQTTManager;

class HowLongScreen extends React.Component {

    constructor(props) {
        super(props)
        
        let device = this.props.state.Device
        let program = this.props.route.params

        let master1 = device.site1_mode == Func.commonFunc.site1_master //master 模式
        
        let times = []
       
        for(i in program.how_long){
            //不显示站点1
            let howLong = program.how_long[i]
            for(k in howLong){
              
                if(master1 && k == '1'){
                    this.site1HowLong = howLong
                    break;
                }
                times.push({
                    s:k,
                    how_long:howLong[k]
                })
            }
        }
        this.state = {    
            program,
            master1,
            channel:device.channels,
            edit:false,
            times
        }

        this.device = device
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
        var times = this.state.times
        var hasZero = false
        times.forEach(value => {
            if(value.how_long == 0){
                hasZero = true
            }
        })
        if(hasZero){
            commFunc.alert(global.lang.wc240bl_time_can_not_zero)
            return
        }

        let newData = JSON.stringify(this.state.times)
        if(newData != this.oldData){
            //有改动
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
    }
    sendToServer(){
        
        let identifier =  '03_program_'+(this.program.tag.toLowerCase())+'_site_how_long'
        
        let times = []
        if(this.site1HowLong){
            times.push(this.site1HowLong)
        }
        /**
         * times 格式：[{s:'1',howlong:1222}]
         * 需要的格式是：['1':12222]
         */
        this.state.times.forEach( element => {
            let obj = {}
            let key = element.s
            obj[key] = element.how_long
            times.push(obj)
        })
        let originArray = this.program.how_long
        originArray.splice(0,originArray.length)
        originArray.push(...times)
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
                [ global.lang.wc240bl_label_edit],
                (index) => {
                    menuView.hidden()

                    if (index == 0) {
                        var times = this.state.times
                       
                        if(times.length < this.state.channel){
                            //补全所有站点
                            var tempTimes = Array(this.state.channel).fill({}).map((_,index)=>{
                                let s = String(index+1)
                                return {s,how_long:0}
                            })
                            console.log('tempTime',tempTimes)
                            if(this.state.master1){
                                tempTimes.splice(0,1)
                            }
                            tempTimes.forEach(value =>{
                                console.log('tempTime',value)
                                for(i in times){
                                    let t = times[i]
                                    if(t.s == value.s){
                                        value.how_long = t.how_long
                                        break;
                                    }
                                }
                            })
                            times = tempTimes
                        }
                        this.setState({
                            edit:true,
                            times
                        })
                    }
                    console.log(index);
                },
                pageY)

        })

    }
    remove(index){
        let times = this.state.times
        if(times.length == 1){
            //至少保留1个吧
            commFunc.alert(global.lang.wc240bl_at_least_one_site)
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
                }
        )
       
    }

    DURConfirm(value){
        let H = value[0];
        let M = value[1];
        let S = value[2];
        if (H < 10) {
            H = '0' + H;
        } 
        if (M < 10) {
            M = '0' + M;
        } 
        if (S < 10) {
            S = '0' + S;
        } 
        let dur = Number(H) * 3600 + Number(M * 60) + Number(S);
        if(dur == 0){
            commFunc.alert(global.lang.wc240bl_time_can_not_zero)
            return
        }
        console.log(this.editIndex,dur);
        if(this.editIndex != null){
           let times = this.state.times
            if(this.editIndex >= 0 && this.editIndex < times.length){
                times[this.editIndex].how_long = dur

                this.setState({
                    times
                })
            }
        }
    }

    programItem = ({item,index}) => {
        
        return (
            <TouchableWithoutFeedback
                underlayColor='none'
                onPress={()=>{
                        this.editIndex = index
                        this.durAlert && this.durAlert.showDialog(index,item.how_long)
                    }}>
                <View style={styles.mainItem}>
                    <Text style={styles.topLeftIndex}>{global.lang.wc240bl_site + item.s}</Text>
                    <Text style={styles.time}>{Func.commonFunc.formatTime(item.how_long,true)}</Text>
                    
                    {
                        this.state.edit ? 
                        <TouchableOpacity style={styles.x} onPress={this.remove.bind(this,index)}>
                            <Text style={styles.xText}>×</Text>
                        </TouchableOpacity> : null
                    }
                    
                </View>
            </TouchableWithoutFeedback>
        )
        
    }
    // save(){
    //     var times = this.state.times
    //     var hasZero = false
    //     times.forEach(value => {
    //         if(value.how_long == 0){
    //             hasZero = true
    //         }
    //     })
    //     if(hasZero){
    //         commFunc.alert(global.lang.wc240bl_time_can_not_zero)
    //         return
    //     }
    //     let programs = this.device.programs
    //     for(i in programs){
    //         if(programs[i].tag == this.program.tag){
    //             console.log('obj',programs[i].tag)
    //             programs[i].how_long = []
    //             if(this.site1HowLong){
    //                 programs[i].how_long.push(this.site1HowLong)
    //             }
    //             times.forEach(v => {
    //                 let obj = {}
    //                 obj[v.s] = v.how_long
                    
    //                 programs[i].how_long.push(obj)
    //             })

    //             break;
    //         }
    //     }
    //     this.state.edit = false
    //     //发送给服务器
    //     this.props.dispatch(actions.Device.updateDevice('programs',programs));
    // }
    render() {
        return (
            <View style={{ flex: 1 }}>
                <StatusBar
                    animated={true}
                    backgroundColor={constants.colors.lightGray}
                    barStyle={'dark-content'} />
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                <Header left={true} title={global.lang.wc240bl_how_long} back={this.back.bind(this)}>
                    <View style={{flexDirection:'row'}}>
                        {
                            this.state.channel == 1 ? null :
                            <TouchableHighlight underlayColor='none' style={styles.menuTouch} onPress={this.showMenu}>
                                <Icon style={styles.meunIcon} name="dots-horizontal" size={30} ></Icon>
                            </TouchableHighlight>
                        }
                       
                    </View>
                </Header>
                <SafeAreaView style={{flex:1, backgroundColor: constants.colors.lightGray}}>
                   
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
        height:90,
        backgroundColor:'white',
        borderRadius:13,
        flexDirection:'row',
       
    },
    time:{
        color:constants.colors.gray,
        fontSize:16,
        flex:1,
        alignSelf:'center',
        textAlign:'center'
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

    topLeftIndex:{
        position:'absolute',
        top:0,
        left:0,
        borderTopLeftRadius:13,
        borderBottomRightRadius:13,
        paddingLeft:5,
        paddingRight:5,
        height:30,
        fontSize:14,
        textAlign:'center',
        ...Platform.select({
            android:{textAlignVertical:'center'},
            ios:{lineHeight:30}
        }),
        color:constants.colors.darkGray,
        backgroundColor:'#DDE5EB'
    },
    listFooter:{
        height:120,
        width:'100%',
        flexDirection:'column',
        justifyContent:'center',
        
    },
  
    saveButton:{
        height:50,
        marginLeft:20,
        marginRight:20,
        backgroundColor:constants.colors.themeColor,
        borderRadius:25,
    },
    saveButtonText:{
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
})(HowLongScreen)