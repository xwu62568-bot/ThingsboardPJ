import React, { Component } from 'react';
import {
    StyleSheet,
    Text,
    View,
    TouchableOpacity,
    Dimensions,
    SafeAreaView,
    NativeModules,
    NativeEventEmitter,
    AppState,
    TextInput,
    FlatList,
        DeviceEventEmitter,
    
} from 'react-native';
import commFunc from '../../../common/util/commFunc';
import Header from '../../../common/component/Header';
import { connect } from 'react-redux'

import constants from '../../../common/constants/constants';
import Common from "../../../common/constants/constants";
import Storage from "../../../common/util/asyncstorage";
import moment from 'moment';
import Command from '../../component/Command';
import bleManager from '../BleManager'

let { width, height } = Dimensions.get('window');
const isIos = Platform.OS === 'ios'

const MQTTManagerEvent1 = NativeModules.MQTTManagerEvent;

const MQTTManagerEventEmitter1 = new NativeEventEmitter(MQTTManagerEvent1);

const mqttManager = NativeModules.RCMQTTManager;
String.prototype.replaceAt = function (index, replacement) {
    return this.substr(0, index) + replacement + this.substr(index + replacement.length);
}

class AutoTest extends React.Component {

    constructor(props) {
        super(props);
        this.openCount = 0
        this.openFailCount = 0
        this.closeCount = 0
        this.closeFailCount = 0

        this.intervalTime = 5
        this.openValveCount = 0
        this.sendCount = 0
        this.receiveCount = 0
        this.tempCount = 0

        this.lastSendCount=0

        this.state = ({
            appState: AppState.currentState,
            Device: this.props.state.Device,
            intervalClose: 5,
            intervalOpen: 5,
            intervalCloseText: '<00:05>',
            intervalOpenText: '<00:05>',
            disable: false,
            isRefreshing: false,            //控制下拉刷新
            isLoadMore: false, //控制上拉加载
            page: 1, //当前请求的页数
            totalCount: 0,              //数据总条数
            recordData: [],
            modelData: [],
            logData: [],
            errorData:[],
        })

        this.routerEvent = this.props.navigation.addListener("blur", payload => {//页面失去焦点
            let data = this.sendCount + ','
                + this.receiveCount
            console.log('2,1');
            Storage.save('statisticData', data);
            // Storage.save('logData', this.state.logData);
            this.backHandler && this.backHandler.remove();
            this.openInterval && clearInterval(this.openInterval);

        });

    }


    componentDidMount() {
        Storage.get('statisticData').then(data => {
            if (data) {
                console.log('statisticData', data);
                let arr = data.split(',')
                this.sendCount = arr[0]
                this.receiveCount = arr[1]
                this.setState({
                })
            }
        });
         //蓝牙监听
        //  this.bleListener = DeviceEventEmitter.addListener('bleListener', (data) => {
        //     if (data.code == 0) {
        //     console.log("receive data:",Command.hexToString( data.buff))//7b ca 00 0a 01 10 41 01 05 38
        //         let buff = data.buff
        //         if (buff) {
                  
        //             let headH = buff[0]
        //             let headL = buff[1]

        //          if (headH == 0x7b && headL == 0xcc) {//设备上报
        //             console.log('11',buff)
        //                if ( Command.CRCCalc(buff,buff.length) != 0) {
        //                 console.log('ff')
           
        //                                          return
        //                                      }
        //                 if (buff.length > 4) {
        //                     console.log('22')

        //                     // 写入数据 [123, 202, 0, 10, 1, 16, 65, 1, 5, 56]
        //                     // write hex: 7bca 000a 01 1041 01 1041 03 0538 7bca000a011041010538
        //                     let hexStr = bleManager.ab2hex(buff.slice(2, 4))//截取整包包长
        //                     let length = bleManager.hex2int(hexStr) //包长
        //                     let valuesLen = length - 2 - 2 - 1 - 2//除去包头2 包长 2 消息id 1 crc 2

        //                     let subBuff = buff.splice(5, valuesLen)//截取到数据段

        //                     for (let i = 0; subBuff.length > 0; i++) {
        //                         console.log('33')

        //                         let valueH = subBuff[0]
        //                         let valueL = subBuff[1]
        //                         let cmd = Command.byteToKLV(valueH, valueL)//取到参数小包
        //                         let value = subBuff.slice(2, 2 + cmd.len)//取参数值
        //                         console.log(cmd,Command.hexToString(value))
        //                         if (cmd.key == 0x01 && cmd.key_id == 0x01) {//0x01 上报的阀状态 
        //                             console.log('44')

        //                                 let siteNumb =-1
        //                                 if (value[0] == 0x00) {//状态关
        //                                     siteNumb = -1
        //                                 } else {
        //                                     switch(value[0]){
        //                                         case 0x01: siteNumb=0;break;
        //                                         case 0x02: siteNumb=1;break;
        //                                         case 0x04: siteNumb=2;break;
        //                                         case 0x08: siteNumb=3;break;
        //                                         case 0x10: siteNumb=4;break;
        //                                         case 0x20: siteNumb=5;break;
        //                                         case 0x40: siteNumb=6;break;
        //                                         case 0x80: siteNumb=7;break;
        //                                     }
        //                                 }
        //                                 let data = this.state.Device
        //                                 console.log('55')

        //                                 if(data){
        //                                     for(i=0;i<data.length;i++){
        //                                         if(siteNumb==-1){
        //                                             data[i].on_off=false                
        //                                         }else{
        //                                             if(siteNumb==i){
        //                                                 data[i].on_off=true                
        //                                             }else{
        //                                                 data[i].on_off=false                
        //                                             }
        //                                         }
        //                                         data[i].isloading=false
        //                                         data[i].timer && clearTimeout(data.timer);
        //                                     }
        //                                 }
        //                                 this.receiveCount = this.receiveCount + 1
        //                                 this.lastSendCount= this.sendCount //记录上次开阀次数 
        //                         } else if (cmd.key == 0x07 && cmd.key_id == 0x01) {//电量等级
        //                             if (value[0] == 0x00) {//电量正常

        //                             } else if (value == 0x01) {//电压低于8v
        //                                 commFunc.alert(global.lang.wc240bl_battery_low)
        //                             } else if (value == 0x02) {//电压低于7.5v
        //                                 commFunc.alert(global.lang.wc240bl_battery_empty)
        //                             }
        //                         }
        //                         subBuff.splice(0, 2 + cmd.len)//截掉已取参数
        //                     }

        //                 }
        //             }
        //         }

        //     } else {

        //     }
        //     this.setState({
        //     })
        // })
    }
    _onRefresh() {
        console.log('>>下拉刷新>>')
        this.setState({
            isRefreshing: true,
            page: 1
        }, () => {
            this.getRecordData()
        })
    }
    _renderItem(item) {
        // console.log(item);
        return (
            <CellComponent data={item.data} time={item.time} >

            </CellComponent>
        )
    }

    ListFooterComponent(isLoadMore) {
        console.log(222 + JSON.stringify(isLoadMore));
        if (isLoadMore) {
            return (
                <View>
                    <View style={{ flexDirection: 'row', color: '#fff', justifyContent: 'center' }}>
                        <ActivityIndicator size="small" animating={true} />
                        {/* <Text style={{ color: 'black' }}>Load more...</Text> */}
                    </View>
                </View>
            )
        } else {
            return null;
        }

    }


    componentWillUnmount() {
        console.log("componentWillUnmount");

        this.controlSubscription1 && this.controlSubscription1.remove();
        this.controlSubscription1 = null;
    }

    back() {
        this.props.navigation.goBack()
    }

    onChange(tag) {
        this.timeAlert && this.timeAlert.showDialog(tag, '');
    }


    start() {
        this.sendCount = 0
        this.receiveCount = 0
        this.setState({
        })

            if (this.openValveCount > 0) {

                this.setState({
                    disable: true
                })

                this.openValveCount--

                let item = this.state.Device.sites[0];
                let value = Command.siteOnOff(item.s, item.on_off ? 0 : 1)
                this.send(value)
                this.sendCount = this.sendCount + 1
                this.setState({
                })

                this.openInterval = setInterval(() => {
                    if (this.openValveCount == 0) {
                        this.openValveCount = this.tempCount
                        this.openInterval && clearInterval(this.openInterval);
                        this.setState({
                            disable: false
                        })
                    } else {
                        this.openValveCount--
                        this.sendCount = this.sendCount + 1
                        this.setState({
                        })
                        let item = this.state.Device.sites[0];
                        let value = Command.siteOnOff(item.s, item.on_off ? 0 : 1)
                        this.send(value)
                    }
                }, this.intervalTime * 1000);

            }


    }
    send(value) {
        bleManager.BleWrite(value, (data) => {
            console.log('蓝牙数据返回===', data)
        }, (err) => {
            loadingView.hidden()
            console.log('写入失败===', err)
        })
    }
    _renderItem(item) {
        // console.log(item);
        return (
            <View>
                <Text >
                    {'差值:' + item.d + '   时间点:' + item.time}
                </Text>
                <View style={{ left: 10, marginRight: 27, backgroundColor: '#DDE5EB', height: 1 }}>
                </View>
            </View>
        )
    }

    changeText = (text, tag) => {
        console.log(text, tag);
        var i = parseInt(text)

        if (tag == 1) {
            if (i == 0) {
                i = 5
            }
            this.intervalTime = i
        } else if (tag == 2) {
            this.openValveCount = i
            this.tempCount = i
        }
        console.log(i);
    }
    render() {
        return (
            //this.props.state.Device.localModifiedStage?'white':constants.colors.statusColor}}>
            <View style={{ flex: 1, backgroundColor: constants.colors.lightGray }}>
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                {/* <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}> */}
                <Header left={true} title={this.state.Device.name} back={this.back.bind(this)}></Header>

                <View style={styles.titleContainer}>
                    <TouchableOpacity style={{ marginTop: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', height: 40 }} >
                        <Text>开关阀间隔：</Text>
                        <TextInput defaultValue={"5"}
                            style={{
                                height: 40, borderBottomColor: 'gray', borderBottomWidth: 1, width: 80, color: constants.colors.themeColor
                            }}
                            onChangeText={text => this.changeText(text, 1)}
                        />
                        {/* <Text style={{color:constants.colors.themeColor}}>{this.state.intervalCloseText}</Text> */}
                    </TouchableOpacity>
                    <TouchableOpacity style={{ marginTop: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', height: 40 }} >
                        <Text>开关阀次数：</Text>
                        <TextInput defaultValue={"0"}
                            style={{
                                height: 40, borderBottomColor: 'gray', borderBottomWidth: 1, width: 80, color: constants.colors.themeColor
                            }}
                            onChangeText={text => this.changeText(text, 2)}
                        />
                        {/* <Text style={{color:constants.colors.themeColor}}>{this.state.intervalOpenText}</Text> */}
                    </TouchableOpacity>

                    <TouchableOpacity style={{ marginTop: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', height: 40, width: 100, borderWidth: 1, borderRadius: 5 }} onPress={this.state.disable ? null : this.start.bind(this)}>
                        <Text>开始</Text>
                    </TouchableOpacity>
                    <View style={{ marginTop: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', height: 40 }} onPress={this.onChange.bind(this)}>
                        {/* <Text style={{color:constants.colors.themeColor}}> */}
                        <Text style={{ color: constants.colors.themeColor }}>{'已发送次数：' + this.sendCount}</Text>
                        {/* <Text style={{color:'red'}}>{this.openFailCount}</Text>
                                <Text style={{color:constants.colors.themeColor}}>{'/'+this.openCount+'>'}</Text> */}
                        {/* </Text>
                                <Text style={{color:constants.colors.themeColor}}> */}
                        {/* <Text style={{ color: 'green' }}>{'             已收到次数：' + this.receiveCount}</Text> */}
                        {/* <Text style={{color:'red'}}>{this.closeFailCount}</Text>
                                <Text style={{color:constants.colors.themeColor}}>{'/'+this.closeCount+'>'}</Text>
                                </Text> */}
                    </View>

                </View>
                  <FlatList
                                            style={styles.flagStyle}
                                            data={this.state.errorData}
                                            renderItem={({ item }) => this._renderItem(item)}
                                            onEndReachedThreshold={0.1}
                                        ></FlatList>
            </View>

        );
    }
}
class CellComponent extends React.Component {

    render() {
        return (
            <View>
                <TouchableOpacity style={styles.cellStytle}>


                    <Text style={styles.timeStyle}>
                        {this.props.time}
                    </Text>
                    <Text style={styles.dataStyle}>
                        {this.props.data}
                    </Text>
                </TouchableOpacity>
                <View style={{ left: 10, marginRight: 27, backgroundColor: constants.colors.lightGray, height: 1 }}>
                </View>
            </View>

        )
    }
}

const w = (Common.window.width - 34 + 22) / 4
const h = (Common.window.height - 200 - 80) / 2

const styles = StyleSheet.create({
    flagStyle: {
        marginLeft: 17,
        marginRight: 17,
        marginTop: 10,
        // marginBottom: 100,
        // backgroundColor:'white'
    },
    titleContainer: {
        // position: 'absolute',
        // justifyContent: 'center',
        alignItems: 'center',
        // marginLeft: 18,
        // marginRight: 18,
        // marginTop: 18,
        height: 300,
        // borderRadius: 13,
        // color: 'transparent'
        backgroundColor: 'white'
    },

    title: {
        fontSize: 14,
        color: constants.colors.darkGray
    },


    slider: {
        flex: 1,
        justifyContent: 'center',
        marginRight: 15,
        marginLeft: 10,
        marginTop: 10,
    },


    btnStyle: {
        height: 44,
        justifyContent: 'center',
        position: 'absolute',
        alignItems: 'center',
        // borderWidth: 1,
        borderRadius: 22,
        left: 15,
        right: 15,
        top: 15,
        backgroundColor: constants.colors.themeColor
    },
    btnContent: {
        height: 100,
        backgroundColor: 'white'
    },
    cellStytle: {
        height: 50,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: constants.colors.gray
    },

    cell: {
        backgroundColor: 'white',
        marginTop: 10,
        marginLeft: 18,
        marginRight: 18,
        borderRadius: 12,
        // borderWidth:1,
        // borderColor:'#dcdcdc',
        height: 66,
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 10,
    },
    slider: {
        flex: 1,
        // marginLeft:10,
        marginRight: 50,
    },

    cellStytle: {
        height: 80,
        // flexDirection: 'row',
        // alignItems: 'center',
        justifyContent: 'center',
        // backgroundColor:'green',

    },

    dataStyle: {
        marginLeft: 15,
        // textAlign: 'center',
        width: Common.window.width - 15,
        color: constants.colors.darkGray,
        // backgroundColor:'#f99902'
    },
    timeStyle: {
        width: Common.window.width - 15,
        marginLeft: 15,

        // justifyContent: 'center',
        // alignItems: 'center',
        // textAlign: 'center',
        // backgroundColor:'#991502',
        color: constants.colors.darkGray,

    },
    durStyle: {
        width: w,
        // justifyContent: 'center',
        // alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'#562327',
        color: constants.colors.darkGray,

    },


});
export default connect((state) => {
    // console.log(state)
    return {
        state
    }
})(AutoTest)
