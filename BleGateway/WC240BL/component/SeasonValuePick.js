import React, { Component } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  Dimensions,
  TouchableWithoutFeedback,
} from 'react-native';

import PickerView from "../../common/component/PickView";
const isIos = Platform.OS === 'ios'

let { width, height } = Dimensions.get('window');

export default class WheelPicker extends React.Component {
    constructor(props) {
        super(props);
        this.state = ({
        animationType: 'fade', //none slide fade
        modalVisible: false, //模态场景是否可见
        transparent: true, //是否透明显示
        selectedValue1: 0,
        index:0,
        title:''
    })
    this.data = this.props.items

    if (this.props.showAlert) {
      this.showDialog();
    }

  }
  componentDidMount(){

  }
  wheelOnChange1(value) {
    console.log("wheelOnChange1 :",value)
    this.setState({
      selectedValue1:value,//data1[ Number(value)],
    })
  }


  render() {
    return (
      <Modal
        animationType={this.state.animationType}
        transparent={this.state.transparent}
        visible={this.state.modalVisible}
        onRequestClose={() => this.setState({ modalVisible: false })}
      >
        <View style={styles.container}>
          <TouchableWithoutFeedback onPress={this._onTapOutside}>
            <View style={styles.overlay} />
          </TouchableWithoutFeedback>
          {
            this.renderAlertView()
          }

        </View>
      </Modal>
    );
  }

  //绘制 alert
  renderAlertView() {
    return (
      <View style={styles.alertView}>

        <View style={styles.titleContainer}>
          <Text style={styles.title}>{this.state.title}</Text>
        </View>
       
        <View style={styles.contentContainer}>

          <View style={isIos ?styles.wheelView1:styles.wheelView2}>
          <PickerView ref={(e)=> this.picker = e} data={this.data} wheelOnChange1={this.wheelOnChange1.bind(this)} isCyclic={this.props.isCyclic ?? false} defaultValue={ Number(this.state.selectedValue1)} wheelWidth={180} ></PickerView>
          </View>

        </View>
    
        <View style={styles.btnContainer}>
          <TouchableOpacity underlayColor="whitesmoke"
            style={styles.btnStyle1}
            onPress={() => {
              this.hideAlertView();
              this.props.cancelClick ? this.props.cancelClick() : null
            }}
          >
            <Text style={styles.btnText2}>{this.props.ok}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            underlayColor="whitesmoke"
            style={styles.btnStyle2}
            onPress={() => {
              this.hideAlertView();
              this.props.comformClik ? this.props.comformClik(
               this.state.selectedValue1,this.state.index
              ) : null
            }}
          >
            <Text style={styles.btnText}>{this.props.cancel}</Text>
          </TouchableOpacity>
        </View>

      </View>
    );
  }

  //隐藏
  hideAlertView() {
    this.setState({
      modalVisible: false,
    });
  }

  //显示
  showDialog(v1,v2,v3) {//slot 确认修改
    this.setState({
      modalVisible: true,
      selectedValue1: v1,
      index:v2,
      title:v3
    })
    setTimeout(()=>{
      this.picker && this.picker.updateValue(v1)
    },1000)
  }
  _onTapOutside = () => {
    this.setState({
      modalVisible: false,

    });
  };

}
const btnW = (width - 100) / 2 - 40;
const styles = StyleSheet.create({
  container: {
    flex: 1,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    position: 'absolute',
    justifyContent: 'center',
    backgroundColor: 'rgba(52,52,52,0.5)',
  },
  overlay: {
    width: width,
    height: height,
    position: 'absolute',
    // backgroundColor: 'rgba(52,52,52,0.5)'
  },
  bgMongo: {
    height: height,
    width: width,
    position: 'absolute',
    backgroundColor: 'transparent'
  },
  alertView: {
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    height: 250,
    marginLeft: 50,
    marginRight: 50,
    borderColor: 'lightgrey',

  },
  titleContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 15,
    marginRight: 15,
    marginTop:10,
    height: 30,
    // backgroundColor:'green'
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold'
  },
  subTitleContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    // flexDirection: 'row',
    // backgroundColor:'green',
    height: 120,
    marginTop:20,
    width: width - 80,
  },

  subTitle: {
    // flex: 1,
    textAlign: 'center',
    fontSize:13,
    // textAlignVertical:'center',
    // justifyContent: 'center',
    // alignItems: 'center',
  },

  contentContainer: {
    flexDirection: 'row',
// backgroundColor:'red',
    height: 140

  },

  content: {
    justifyContent: 'center',
    marginLeft: 20,
    marginRight: 20,
    fontSize: 14
  },

  btnContainer: {
    flexDirection: 'row',
    // backgroundColor:'red',
    height: 58,
    // marginTop:10,
    width: width - 80,
  },
  lineV: {
    height: 50,
    backgroundColor: 'lightgrey',
    width: 0.5
  },
  btnStyle: {
    flex: 1,
    height: 47,
    // width:60,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 25,
  },
  btnStyle1: {
    height: 45,
    width: btnW,
    justifyContent: 'center',
    alignItems: 'center',
    // borderWidth: 1,
    borderRadius: 20,
    marginLeft: 30,
    marginTop: 5,
    backgroundColor: '#ececec'
  },
  btnStyle2: {
    height: 45,
    width: btnW,
    justifyContent: 'center',
    alignItems: 'center',
    // borderWidth: 1,
    borderRadius: 20,
    marginLeft: 20,
    marginTop: 5,
    backgroundColor: '#ececec'

  },
  btnText: {
    fontSize: 16,
    // color: '#157efb',
    fontWeight: '700',

  },

  btnText2: {
    fontSize: 16,
    // color: '#157efb',
  },

  wheelView1: {
    flexDirection: 'row',
    width: (width - 100) ,
    // marginLeft: 20,
    // marginRight: 20,
    height: 140,
    // backgroundColor:'purple',
    justifyContent: 'center',
    alignItems: 'center',
  },

  wheelView2: {//for android
    flexDirection: 'row',
    width: (width - 100),
    // marginLeft: 20,
    // marginRight: 20,
    height: 140,
    // backgroundColor:'purple',
    // justifyContent: 'center',
    // alignItems: 'center',
  }
});