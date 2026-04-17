import React, { PureComponent } from 'react'
import {
    View,
    Text,
    SafeAreaView,
    StyleSheet,
    TouchableHighlight,
    TouchableOpacity,
    RefreshControl,
    ActivityIndicator,
    findNodeHandle,
    NativeEventEmitter,
    NativeModules,
    Image,
    SectionList,

} from 'react-native'
import Header from '../../../common/component/Header'
import Common from "../../../common/constants/constants";
import * as urls from '../../../common/constants/constants_url';
import request from '../../../common/util/request';
import { connect } from 'react-redux'
import moment from 'moment';
import constants from '../../../common/constants/constants';
import Icon from "react-native-vector-icons/MaterialCommunityIcons";
import { menuView } from "../../../common/component/menuView";

import Func from "../../component/Func"
import commFunc from '../../../common/util/commFunc';



class Record extends React.Component {
    constructor(props) {
        super(props)
        this.count = 0
        this.showSite = 0
        this.collapseDate = []//折叠的日期的数组
        this.state = {
            isRefreshing: false,            //控制下拉刷新
            isLoadMore: false, //控制上拉加载
            page: 1, //当前请求的页数
            totalCount: 0,              //数据总条数
            recordData: [],
            showData: [],
        }
    }
    getRecordData() {
        // const { page, recordData } = this.state || {}
        console.log("page" + this.state.page);
        // /recordMessage/{lorEUI}/recordMessages?commandKeyType=6&limit=10&page=1
        let url = global.urlHost + urls.kUrlRecordList
        console.log(url);
        let header = { Authorization: this.props.state.Device.Authorization }
        let data = {
            loraEUI: this.props.state.Device.serialNumber,
            identifier: Func.wc240bl.record,
            limit: 50,
            page: String(this.state.page)
        }
        console.log(data, header)
        request.post(url, data, header,
            (status, code, message, data, share) => {
                console.log("recordData", JSON.stringify(data.recordMessageList, null, "\t"), 'kkkkkkkkkkkkkkk');
               
                let formatedData = this.dataFormart(data.recordMessageList)

                if (this.state.page === 1) {
                  
                    console.log("recordData count1", this.state.recordData.length);
                    
                    this.collapseDate = []
                    this.state.recordData = formatedData
                    this.state.totalCount = data.meta.count
                    this.state.isRefreshing = false
                   
                    this.grouping()
                   
                    console.log(this.state.totalCount);

                } else {
                    console.log("recordData count2", this.state.recordData.length);

                    this.state.recordData.push(...formatedData)
                    this.state.isLoadMore = false

                    this.grouping()
                }

                this.setState({

                })
                
            },
            (error) => {
                console.log('error', error);
                this.setState({
                    isLoadMore: false,
                    isRefreshing: false
                })
            });
    }
    componentDidMount() {
        this.getRecordData();
    }
    showMenu = (e) => {//显示 隐藏 菜单
        const handle = findNodeHandle(e.target);
        NativeModules.UIManager.measure(handle, (x, y, width, height, pageX, pageY) => {
            // console.warn(x, y, width, height, pageX, pageY)
            let menu = [global.lang.wc240bl_adjust_all]
            for(i = 1; i<= this.props.state.Device.channels; i++){
                menu.push(global.lang.wc240bl_site+i)
            }
            menuView.show(menu,
                (index) => {
                    menuView.hidden()

                    this.showSite = index
                    
                    this.grouping()
                    this.setState({
                    })

                    console.log(index);
                },
                pageY)
        })

    }
    
    grouping() {
        //  使用SectionList 需要固定数据格式为[{title:'',data:[]},{title:'',data:[]}]
      
        /**
         * it = {
                date: '',
                time: '',
                site: 0,
                dur: '',
            }
         */
        //日期分组和筛选站点
        let groupData = this.state.recordData.reduce((result, currentItem) => {
            if(this.showSite != 0 && this.showSite != currentItem.site){
                //不是显示全部站点，且 不是选中的站点，则返回
                return result
            }
            const groupKey = currentItem['date']
            if(!result[groupKey]){
                result[groupKey] = {
                    items:[],
                }
            }
            result[groupKey]['items'].push(currentItem)
            return result
        },{})
        let showData = []
        let keys = Object.keys(groupData)
        keys.forEach(key => {
            showData.push({
                title:key,
                isShow: this.collapseDate.indexOf(key) < 0,
                data:groupData[key].items,
            })
        })

        
        this.state.showData = showData
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
    dataFormart(data) {
        // this.setState({
        //     modelData: [],
        // })
        let modelData = []
        let channels = this.props.state.Device.channels
        for (const key in data) {
            it = {
                date: '',
                time: '',
                site: 0,
                dur: '',
            }
            const item = data[key];
            // console.log("item",item);
            //{'site':1,'datetime':112345234,'how_long':300}
            let value = JSON.parse(item.identifierValue);//0160E6D01D0005

            let howlong = value.how_long
            let h = parseInt(howlong / 3600);
            let m =parseInt((howlong % 3600) / 60);
            let s =parseInt( howlong % 60)

            if (h < 10) {
                h = "0" + h;
            }
            if (m < 10) {
                m = "0" + m;
            }
            if (s < 10) {
                s = "0" + s;
            }
            it.dur = h + ':' + m + ':' + s;


            var utcDate = moment.utc(value.datetime);
            var localDate = moment(utcDate).local();

            it.date = localDate.format("YYYY/MM/DD");
            it.time = localDate.format("HH:mm");
            it.site = value.site
           
            if(channels == 8){
                if (value.mode == 1) {
                    it.m = 'M'
                } else if (value.mode == 2) {
                    it.m = 'T'
                } else if (value.mode == 3) {
                    it.m = 'C'
                } else if (value.mode == 4) {
                    it.m = 'R'
                }else{
                    it.m = "M"
                }
                it.result = value.result ?? 0
            }else{
                if(value.mode == 0){
                    it.m = 'C'
                }else if(value.mode == 1){
                    it.m = 'T'
                }else if(value.mode == 2){
                    it.m = 'M'
                }else{
                    it.m = 'M'
                }
            }

            if(channels == 1){
                it.site = null
            }else if(it.site==null || it.site==""){
                it.site = " "//2路或4路或8路 加个空格占位
            }
            modelData.push(it);
            // console.log("newData:", JSON.stringify(newData, null, "\t"));

            // console.log(newData);

        }
        return modelData
    }
    _onEndReached() {
        console.log('>>上拉加载>>>')
        // console.log(recordData.length + "" + totalCount + isLoadMore);
        if (this.state.recordData.length < this.state.totalCount && !this.state.isLoadMore) {
            this.setState({
                page: this.state.page + 1,
                isLoadMore: true
            }, () => {
                this.getRecordData()
            })
        }
        // else{
        //     this.setState({
        //         isLoadMore: false
        //       })
        // }
        console.log("up page", this.state.page);

        // console.log(333 + JSON.stringify(isLoadMore));

    }
   
    showHiden = (info) => {
        console.log('info',info.section.isShow)
        let title = info.section.title
        let isShow = info.section.isShow
        if(!isShow){
            let index = this.collapseDate.indexOf(title)
            if(index >= 0){
                this.collapseDate.splice(index,1)
            }
        }else{
            if(this.collapseDate.indexOf(title) < 0){
                this.collapseDate.push(info.section.title)
            }
        }
        info.section.isShow = !isShow
        this.setState({})
    }
    // listItem (section,item,index){

    //     return (
    //         section.isShow ? <CellComponent time={item.time} site={item.site} duration={item.dur} indx = {index} dataCount={section.data.length}>

    //         </CellComponent> : null

    //     )

    // }
    wc280blListItem (section,item,index){
        //console.log("列表：",item,section)
        return (
            section.isShow ? <WC280BLCellComponent
                m={item.m} 
                data={item.time} 
                time={item.site} 
                duration={item.dur} 
                res={item.result} 
                indx = {index} 
                dataCount={section.data.length}/> : null
        )
    }
    multiListItem(section,item,index){
        return (
            section.isShow ? <CellComponent
                m={item.m} 
                site={item.site} 
                time={item.time} 
                duration={item.dur}
                indx = {index} 
                dataCount={section.data.length}/> : null
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
    sectionHeaderComponent = (item) => {
        return (
            <TouchableOpacity style={{ height: 35, justifyContent: 'center', backgroundColor: constants.colors.lightGray }} onPress={this.showHiden.bind(this, item)}>
                <Text
                    style={{color:constants.colors.darkGray, fontSize: 15 }}>{item.section.title}
                </Text>
                <Image style={{ position: 'absolute', width: 15, height: 15, right: 0, resizeMode: 'contain' }} source={{ uri:item.section.isShow ? 'show' : 'hiden' }} />
            </TouchableOpacity>

        )
    }
    render() {
           let channels = this.props.state.Device.channels
        return (
            <View style={{ backgroundColor: constants.colors.lightGray, flex: 1 }}>
                <SafeAreaView style={{ backgroundColor: constants.colors.lightGray }}></SafeAreaView>
                {/* <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}> */}
                <TouchableHighlight style={{ width: constants.window.width, height: 44 }}>
                   <Header left={false} title={global.lang.wc240bl_record} >
                       {channels>1? <TouchableHighlight underlayColor='none' style={styles.menuTouch} onPress={this.showMenu}>
                            <Icon style={styles.meunIcon} name="dots-horizontal" size={30} ></Icon>
                        </TouchableHighlight>:null} 
                    </Header>
                </TouchableHighlight>
                {
                    this.props.state.Device.channels == 8 ?
                    <WC280BLCellComponent
                        m={global.lang.wc240bl_open_mode}
                        site={global.lang.wc240bl_site} 
                        time={global.lang.wc240bl_time} 
                        duration={global.lang.wc240bl_duration} 
                        resText={global.lang.wc240bl_result} 
                        style={styles.fristCellStytle} info={'infor'}/>
                        : this.props.state.Device.channels == 1 ?
                   <CellComponent
                        m={global.lang.wc240bl_open_mode}//单路不需要站点号
                        time={global.lang.wc240bl_time} 
                        duration={global.lang.wc240bl_duration} 
                        style={styles.fristCellStytle} info={'infor'}/>
                    :  <CellComponent
                            m={global.lang.wc240bl_open_mode}
                            site={global.lang.wc240bl_site} 
                            time={global.lang.wc240bl_time} 
                            duration={global.lang.wc240bl_duration} 
                            style={styles.fristCellStytle} info={'infor'}/>
                }

                <SectionList
                    // stickySectionHeadersEnabled={true}
                    renderSectionHeader={this.sectionHeaderComponent}
                    renderItem={({ section,item, index }) => 
                        this.props.state.Device.channels == 8 ?
                        this.wc280blListItem(section,item,index) : this.multiListItem(section,item,index)    
                    }
                    sections={this.state.showData}
                    style={styles.flagStyle}
                    extraData={this.state}
                    // data={this.state.showData}
                    keyExtractor={(item, index) => index.toString()}
                    onEndReachedThreshold={0.1}
                    refreshControl={
                        <RefreshControl
                            refreshing={this.state.isRefreshing}
                            tintColor={'gray'}
                            size={'default'}
                            onRefresh={() => {
                                this._onRefresh()
                            }}
                        />
                    }
                    ListFooterComponent={this.ListFooterComponent(this.state.isLoadMore)}
                    onEndReached={() => { this._onEndReached() }}
                ></SectionList>
                {/* <Text style={styles.textStyle}>{'M:' + global.lang.wc800lc_label_manual_open + ' ' + 'C:' + global.lang.wc800lc_label_remote_open + '\n' + 'T:' + global.lang.wc800lc_label_local_timer_open + ' ' + 'R:' + global.lang.wc800lc_label_remote_controller}</Text> */}
            </View>
        )
    }
}

// class CellComponent extends PureComponent {
  
//     render() {
//         return (
//             <View>
//                 <TouchableOpacity style={[this.props.indx ==0 ? styles.topCellStytle : null, this.props.indx ==this.props.dataCount-1 ?styles.bottomCellStytle : null,styles.cellStytle, this.props.style]}>


                   
//                     <Text style={styles.timeStyle}>
//                         {this.props.time}
//                     </Text>
//                     <Text style={styles.siteStyle}>
//                         {this.props.site}
//                     </Text>
//                     <Text style={styles.durStyle}>
//                         {this.props.duration}
//                     </Text>
                                     
//                 </TouchableOpacity>

//                 <View style={{ left: 10, marginRight: 27,backgroundColor:constants.colors.lightGray, height: 1 }}>
//                     </View>
              
//             </View>

//         )
//     }
// }


class WC280BLCellComponent extends PureComponent {
    showInfor = (res) => {
        if (res == 1) {
            commFunc.alert(global.lang.wc240bl_no_completely_as_manual_canceled)
        } else if (res == 2) {
            commFunc.alert(global.lang.wc240bl_no_exe_as_manual_canceled)
        } else if (res == 3) {
            commFunc.alert(global.lang.wc240bl_no_exe_as_standby)
        } else if (res == 4) {
            commFunc.alert(global.lang.wc240bl_no_exe_as_site_diaabled)
        } else if (res == 5) {
            commFunc.alert(global.lang.wc240bl_no_exe_as_rain)
        } else if (res == 6) {
            commFunc.alert(global.lang.wc240bl_no_exe_as_site_no_valve)
        } else if (res == 7) {
            commFunc.alert(global.lang.wc240bl_plan_conflicting)
        } else if (res == 666) {
            commFunc.alert('M:' + global.lang.wc240bl_mode_key_manual + '\n' + 'C:' + global.lang.wc240bl_mode_app_manual + '\n' + 'T:' + global.lang.wc240bl_mode_alarm )
        }
    }
    render() {
        return (
            <View>
                <TouchableOpacity style={[this.props.indx ==0 ?styles.topCellStytle : ( this.props.indx ==this.props.dataCount-1 ?styles.bottomCellStytle : styles.cellStytle), this.props.style]}>


                    <Text style={styles.mMultiStyle}>
                        {this.props.m}
                    </Text>
                    <Text style={styles.multiDataStyle}>
                        {this.props.site}
                    </Text>
                    <Text style={styles.multiTimeStyle}>
                        {this.props.time}
                    </Text>
                    <Text style={styles.multiDurStyle}>
                        {this.props.duration}
                    </Text>
                  
                    {
                        this.props.resText != null ?
                            <Text style={styles.multiResStyle}>
                                {this.props.resText}
                            </Text> : <TouchableOpacity style={styles.multiBtnStyle} onPress={this.showInfor.bind(this, this.props.res)}>
                                <Text style={styles.multiResStyle}>
                                    {this.props.res == 0 ? 'OK' : 'E' + this.props.res}
                                </Text>
                                {this.props.res != 0 ? <Image style={{ position: 'absolute', width: 18, height: 18, right: 5 }} source={{ uri: 'infor' }} /> : null}
                            </TouchableOpacity>
                    }
                    {this.props.info != null ? <Image style={styles.multiLeftInfoStyle} source={{ uri: 'infor' }} /> : null}
                    {this.props.info != null ? <TouchableOpacity style={styles.multiLeftBtnStyle} onPress={this.showInfor.bind(this, 666)} ></TouchableOpacity> : null}
                   
                </TouchableOpacity>

                <View style={{ left: 10, marginRight: 27,backgroundColor:constants.colors.lightGray, height: 1 }}>
                    </View>
              
            </View>

        )
    }
}
/**
 * 1 2或4路
 */
class CellComponent extends PureComponent {
    showInfor = (res) => {
        if (res == 666) {
            commFunc.alert('M:' + global.lang.wc240bl_mode_key_manual + '\n' + 'C:' + global.lang.wc240bl_mode_app_manual + '\n' + 'T:' + global.lang.wc240bl_mode_alarm )
        }
    }
    render() {
        return (
            <View>
                <TouchableOpacity style={[this.props.indx ==0 ?styles.topCellStytle : ( this.props.indx ==this.props.dataCount-1 ?styles.bottomCellStytle : styles.cellStytle), this.props.style]}>

                    <TouchableOpacity onPress={ ()=> { this.props.info != null ? this.showInfor(666) : null }} style={styles.mode1Style}>
                        <Text style={{color: constants.colors.darkGray}}>
                            {this.props.m}
                        </Text>
                        {this.props.info != null ? <Image style={styles.info1Style} source={{ uri: 'infor' }} /> : null}
                    </TouchableOpacity>
                    
                    {
                        this.props.site ?
                        <Text style={styles.time1Style}>
                            {this.props.site}
                        </Text> : null
                    }
                    <Text style={styles.site1Style}>
                        {this.props.time}
                    </Text>
                    <Text style={styles.dur1Style}>
                        {this.props.duration}
                    </Text>
                   
                   
                </TouchableOpacity>

                <View style={{ left: 10, marginRight: 27,backgroundColor:constants.colors.lightGray, height: 1 }}>
                    </View>
              
            </View>

        )
    }
}

const w = (Common.window.width - 34 + 22) / 5
const styles = StyleSheet.create({
    flagStyle: {
        marginLeft: 17,
        marginRight: 17,
        marginTop: 13,
        marginBottom: 5,
        // borderRadius: 13,
        // backgroundColor: 'white'
    },
    textStyle: {
        marginLeft: 20,
        marginRight: 17,
        marginBottom: 5,
        fontSize: 10,
        color: constants.colors.darkGray,
        // fontWeight:"bold"
    },
    cellStytle: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'white',
        // borderRadius: 13,
        marginBottom:-1,
    },
    topCellStytle: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'white',
        borderTopLeftRadius: 13,
        borderTopRightRadius:13,
        marginBottom:-1,
    },
    bottomCellStytle: {
        height: 48,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'white',
        borderBottomLeftRadius: 13,
        borderBottomRightRadius:13,
        marginBottom:-1,
    },
    fristCellStytle: {
        marginTop: 13,
        marginLeft: 17,
        marginRight: 17,
        borderRadius: 13,
        backgroundColor: 'white',
        height: 66,
        flexDirection: 'row',
        alignItems: 'center',
    },
   
    
    timeStyle: {
        // marginLeft: 15,
        textAlign: 'center',
        flex:1,
        color: constants.colors.darkGray,
        // backgroundColor:'#f99902'
    },
    siteStyle: {
        flex:1,
        // justifyContent: 'center',
        // alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'#991502',
        color: constants.colors.darkGray,

    },
    durStyle: {
        flex:1,
        // justifyContent: 'center',
        // alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'#562327',
        color: constants.colors.darkGray,

    },
    mode1Style: {
        flex:1,
        flexDirection:'row', 
        justifyContent:'center',
        alignItems:'center',
    },   
    time1Style: {
        // marginLeft: 15,
        textAlign: 'center',
        flex:1,
        color: constants.colors.darkGray,
        // backgroundColor:'#f99902'
    },
    site1Style: {
        flex:1,
        // justifyContent: 'center',
        // alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'#991502',
        color: constants.colors.darkGray,

    },
    dur1Style: {
        flex:1,
        // justifyContent: 'center',
        // alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'#562327',
        color: constants.colors.darkGray,

    },
    info1Style: {
        width: 18, height: 18, top: -8, left: 2
    },
    info1BtnStyle: {
        position: 'absolute', width: w, height: 60, left: 0,
        // backgroundColor:'red'
    },
    mMultiStyle: {
            // marginLeft: 15,
            textAlign: 'center',
            width: w - 25,
            color: constants.colors.darkGray,
            // backgroundColor:'#999442'
    },
    multiDataStyle: {
            // marginLeft: 15,
            textAlign: 'center',
            width: w + 10,
            color: constants.colors.darkGray,
            // backgroundColor:'#f99902'
        },
    multiTimeStyle: {
        width: w - 22,
        // justifyContent: 'center',
        // alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'#991502',
        color: constants.colors.darkGray,

    },
    multiDurStyle: {
        width: w + 7,
        // justifyContent: 'center',
        // alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'#562327',
        color: constants.colors.darkGray,

    },
    multiResStyle: {
        width: w - 5,
        // justifyContent: 'center',
        // alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'red',
        color: constants.colors.darkGray,
    },
    multiBtnStyle: {
        width: w - 5,
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        // backgroundColor:'#562327',
        color: constants.colors.darkGray,
        width: w - 5,
        // backgroundColor:'#562327',
        // color:constants.colors.darkGray,
        height: 45
    },
    multiLeftInfoStyle: {
        position: 'absolute', width: 18, height: 18, top: 16, left: w - 28
    },
    multiLeftBtnStyle: {
        position: 'absolute', width: w, height: 60, left: 0,
        // backgroundColor:'red'
    },
});

export default connect((state) => {
    // console.log(state)
    return {
        state
    }
})(Record)