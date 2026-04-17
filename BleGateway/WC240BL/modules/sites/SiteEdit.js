import React, { useState } from 'react'

import {
    View,
    Text,
    SafeAreaView,
    TextInput,
    NativeModules,
    findNodeHandle,
    NativeEventEmitter,
    TouchableOpacity,
    StyleSheet,
    StatusBar,
    BackHandler,


} from 'react-native'
import { connect } from 'react-redux'
import constants from '../../../common/constants/constants';
import Header from '../../../common/component/Header';
import AlertView from "../../../common/component/AlertView";
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import * as ImagePicker from 'react-native-image-picker';
import Icon1 from "react-native-vector-icons/MaterialIcons";
import actions from '../../../WV100LR/store/actions/Index';
import * as urls from '../../../common/constants/constants_url';
import ImageView from "../../../common/component/ImageView";
import request from '../../../common/util/request';
import { loadingView } from "../../../common/component/loadingView";
import { menuView } from "../../../common/component/menuView";
import commFunc from '../../../common/util/commFunc';


const MQTTManagerEvent = NativeModules.MQTTManagerEvent;

const MQTTManagerEventEmitter = new NativeEventEmitter(MQTTManagerEvent);

const mqttManager = NativeModules.RCMQTTManager;

class SitesEditScreen extends React.Component {

    constructor(props) {
        super(props)
        this.state = {
            item:this.props.route.params,
            selectUri: '',
            tempSensor_state:'',
            tempPower:0,
        }

        this.routerEvent = this.props.navigation.addListener("blur", payload => {//页面失去焦点

            this.backHandler && this.backHandler.remove();

        });
        this.routerEvent = this.props.navigation.addListener("focus", payload => {//页面获取焦点
          
         let it = this.props.route.params
            this.setState({
                item:it
            })
            this.backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
                this.back()
                return true
            })
        });

    }

    componentDidMount() {

   
     

        this.controlSubscription = MQTTManagerEventEmitter.addListener(
            'KMqttControl',
            (control) => {
                console.log(' receive111:', control)
                if(control.code != 200){
                    //出现错误
                    return
                }
                let phonoId = '08_' + 'site' + this.state.item.s + '_photo'
                let nameId = '08_' + 'site' + this.state.item.s + '_name'
                let it = this.state.item

                for (let index = 0; index < control.deviceAttrList.length; index++) {
                    let item = control.deviceAttrList[index];
                    switch(item.identifier){
                        case phonoId: 
                        it.photo = item.identifierValue

                        this.setState({
                           item:it
                        })
                        loadingView.hidden()
                        break;
                        case nameId: 
                        it.name = item.identifierValue

                        this.setState({
                           item:it
                        })
                        loadingView.hidden()
                        break;
                      
                    }
                }
                
            },

        );
    }
    componentWillUnmount(){
        this.controlSubscription && this.controlSubscription.remove();
        this.controlSubscription = null;
    }
    back() {//返回原生页面

        this.props.navigation.goBack()
    }
    showMenu = (e) => {//显示 隐藏 菜单

        const handle = findNodeHandle(e.target);
        NativeModules.UIManager.measure(handle, (x, y, width, height, pageX, pageY) => {
            // console.warn(x, y, width, height, pageX, pageY)

            menuView.show(
                [global.lang.wc240bl_take_photo	
                    ,global.lang.wc240bl_pick_from_album],
                (index) => {
                    let data
                    if (index == 0) {
                        ImagePicker.launchCamera({
                            saveToPhotos: true,
                            mediaType: 'photo',
                            // presentationStyle:'fullScreen',
                            // includeBase64: true,
                            // includeExtra:true,
                        }, res => {
                            menuView.hidden()
                            if (res.didCancel) {
                                return false;
                            }

                            if(res.errorCode==null){
                                data = res.assets[0]
                                if (data) {
                                    loadingView.show()
                                    this.upload(data)
                                }
                            }else{
                                commFunc.alert(global.lang.wc240bl_no_camera_permission)
                            }
                          
                        });

                    } else {

                        ImagePicker.launchImageLibrary({
                            saveToPhotos: true,
                            mediaType: 'photo',
                            // includeBase64: true,
                        }, res => {
                            menuView.hidden()

                            if (res.didCancel) {
                                return false;
                            }
                            // this.setState({
                            //     selectUri :res.assets[0].uri
                            // })
                            if(res.errorCode==null){
                                data = res.assets[0]

                                console.log(data)
    
                                if (data) {
                                    loadingView.show()
                                    this.upload(data)
                                }
                            }
                           
                        });
                    }
                    console.log(index);
                },
                pageY, pageX)

        })


    }

    upload(value) {

        let url = global.urlImage + urls.URL_UploadPhoto
        let header = { Authorization:this.props.state.Device.Authorization }

        const formData = new FormData();
        formData.append('file', {
            uri: value.uri,
            type: value.type,
            name: value.fileName,
        });
        console.log(url, header, formData);

        request.upload(url, formData, header,
            (status, code, message, data, share) => {
                
                console.log("uploadImage:", JSON.stringify(data, null, "\t"));
               this.setImage(data)
            },
            (error) => {
                loadingView.hidden()
            });
    }

    setImage(data){
        let id = '08_' + 'site' + this.state.item.s + '_photo'
        var dic = {
            attrArray:
                [
                    {
                        identifier: id,
                        identifierValue: data,
                    }
                ]
        }
            console.log('send:', dic['attrArray']);
            mqttManager.controlDeviceWithDic((dic))
      

      
    }
    setName(name){
        let id = '08_' + 'site' + this.state.item.s + '_name'
        var dic = {
            attrArray:
                [
                    {
                        identifier: id,
                        identifierValue: name,
                    }
                ]
        }
       
        console.log('send:', dic['attrArray']);
        mqttManager.controlDeviceWithDic((dic))
    }
    selecImg(type) {

    }

    selectItem = (index) => {

        if (index == 0) {
            let item = this.state.item
            var newName = this.setSiteName(item)
            let title = global.lang.wc240bl_label_device_name
            AlertView.show(title,
                <TextInput
                    style={{ height: 50, borderBottomColor: 'gray', borderBottomWidth: 1, width: 258 }}
                    onChangeText={text => {
                        console.log(text, title);
                        let t = global.lang.wc240bl_toolong
                        if (text.length > 20) {
                            commFunc.alert(t)
                        } else {
                            newName = text
                        }
                    }}
                    defaultValue={newName}
                />,
                global.lang.wc240bl_label_cancel,
                global.lang.wc240bl_label_save,

                () => { AlertView.hidden() },
                () => {
                    if (newName.length > 20) {
                        let t = title + global.lang.el100lr_toolong
                        commFunc.alert(t)
                    } else {
                        AlertView.hidden()
                        //准备提交
                                if (item.name != newName) {
                                   
                                    this.setName(newName)
                                   
                                }
                      
                    }
                })

        } 
    }
    setSiteName(item){
        if(item.name){
            return item.name
        }else{
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
      
        
    }
    initUI() {

        return (
            <View >
                <ImageView style={{ height: 142, borderRadius: 13, left: 18, marginRight: 18, top: 18, marginBottom: 18 }} source={{ uri: global.urlImage + urls.kUrlImage + this.state.item.photo}} placeholderSource={{ uri: 'garden' }} />
                <TouchableOpacity style={styles.viewTopLeft} onPress={this.showMenu.bind(this)}>
                    <Icon style={styles.meunIcon} name="dots-horizontal" size={30} ></Icon>
                    {/* <Text style={styles.textTopLeft}>{64}</Text> */}
                </TouchableOpacity>

                <View style={{ height: 45, borderRadius: 13, marginLeft: 18, marginRight: 18, marginTop: 18, backgroundColor: 'white' }}>
                    <View style={[styles.subCellStytle]}>


                        <Text numberOfLines={1} ellipsizeMode='middle' style={{}}>{global.lang.wc240bl_site_name}</Text>
                        <TouchableOpacity style={{ position: 'absolute', right: 0, height: 45, flexDirection: 'row', alignItems: 'center' }} activeOpacity={0.5} onPress={this.selectItem.bind(this, 0)}>
                            <Text style={styles.dataValueStyle} numberOfLines={1} >
                                {this.setSiteName(this.state.item)}
                            </Text>
                            <Icon1 name={'arrow-forward-ios'} size={18} style={styles.arrowStyle}></Icon1>
                        </TouchableOpacity>
                    </View>
                   
                </View>

            </View>

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
                <Header left={true} title={this.props.state.Device.name} back={this.back.bind(this)}>
                </Header>
                <SafeAreaView style={{ flex: 1, backgroundColor: constants.colors.lightGray }}>
                    {this.initUI()}
                </SafeAreaView>

            </View>
        )
    }
}


const styles = StyleSheet.create({
    subCellStytle: {
        marginLeft: 15,
        height: 45,
        // marginRight:15,
        flexDirection: 'row',
        alignItems: 'center',
    },


    dataStyle: {
        marginLeft: 17,
        textAlign: 'left',
        color: constants.colors.darkGray,
        flex: 1,
        // width:w,
        // backgroundColor:'#999902'
    },

    dataValueStyle: {
        marginLeft: 10,
        marginRight: 38,
        textAlign: 'right',
        //
        color: constants.colors.darkGray,
        // width:w,
        // backgroundColor:'#999902',
        ...Platform.select({
            ios: { lineHeight: 35 },
            android: {
                height: 35,
                textAlignVertical: 'center'
            }
        })
    },
    arrowStyle: {
        position: 'absolute',

        right: 15,
        // textAlign:'left',
        // width:w,
        // backgroundColor:'#999902'
    },


    viewTopLeft: {
        position: 'absolute',
        // opacity:0.8,
        top: 25,
        right: 25,
        width: 35,
        height: 35,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)'
    },

    meunIcon: {
        // justifyContent: 'center',
        // padding:"50%",
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
    },
})
export default connect((state) => {
    return {
        state
    }
})(SitesEditScreen)

