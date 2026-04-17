/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 * @flow strict-local
 */
import React from 'react';
import {
  StyleSheet,
  View,
  StatusBar,
  Image
} from 'react-native';

import Func from './component/Func';
import { Provider } from 'react-redux'
import reducers from '../WV100LR/store/reducers/Index'
import thunk from 'redux-thunk'
import { createStore, applyMiddleware } from 'redux';
import constants from '../common/constants/constants';
import { createStackNavigator } from '@react-navigation/stack'
import { NavigationContainer } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import Home from './modules/home/Home';
import Site from './modules/sites/SiteStack';
import Program from './modules/programes/Program';
import Record from './modules/record/Record'
import Edit from './modules/edit/EditStack';
import SiteEdit from './modules/sites/SiteEdit';
import ProgramEditScreen from './modules/programes/ProgramEdit';
import RepeatScreen from './modules/programes/Repeat';
import TimesScreen from './modules/programes/Times';
import HowLongScreen from './modules/programes/HowLong';
import PlanListScreen from './modules/programes/PlanList';
import PlanListRotationScreen from './modules/programes/PlanListRotation';
import AutoTest from '../WC240BL/modules/home/AutoTest';

import { RootSiblingParent } from 'react-native-root-siblings';
import lan from './Languages'

var RNFS = require('react-native-fs');

let store = createStore(reducers, applyMiddleware(thunk))

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

const tabIcon1 = (focused) => {
  return (
    focused.focused?<Image style={{width:28,height:28}} source={{uri:'home_select'}}/>:
    <Image style={{width:28,height:28}} source={{uri:'home'}}/>
  )
}
const tabIcon2 = (focused) => {
  return (
    focused.focused?<Image style={{width:28,height:28}} source={{uri:'programes_select'}}/>:
    <Image style={{width:28,height:28}} source={{uri:'programes'}}/>
    // <Icon name='time' size={28} color={'red'}></Icon>
  )
}
const tabIcon3 = (focused) => {
  return (
    focused.focused?<Image style={{width:28,height:28}} source={{uri:'record_select'}}/>:
    <Image style={{width:28,height:28}} source={{uri:'record'}}/>
    // <Icon name='record_select' size={28} color={focused.color}></Icon>
  )
}
const tabIcon4 = (focused) => {
  return (
    focused.focused?<Image style={{width:28,height:28}} source={{uri:'site_select'}}/>:
    <Image style={{width:28,height:28}} source={{uri:'site'}}/>
    // <Icon name='record_select' size={28} color={focused.color}></Icon>
  )
}

class App extends React.Component {

  constructor(props) {
    super(props)
    this.state = {
      flag: false
    }

  }

  Tab(params) {
    // console.log("TAB "+JSON.stringify(params));
    return (
      <Tab.Navigator initialRouteName='Home' screenOptions={{headerShown : false,tabBarActiveTintColor: constants.colors.themeColor,tabBarInactiveTintColor:constants.colors.darkGray ,tabBarLabelStyle:{fontSize:12}}}>
        <Tab.Screen name='Home' component={Home} initialParams={params.route.params} options={{ title: global.lang.wc240bl_home, tabBarIcon: tabIcon1}} />
        <Tab.Screen name='Sites' component={Site} initialParams={params.route.params} options={{ title: global.lang.wc240bl_sites, tabBarIcon: tabIcon4}} />
        <Tab.Screen name='Programes' component={Program} options={{ title: global.lang.wc240bl_program, tabBarIcon: tabIcon2 }} />
        <Tab.Screen name='Record' component={Record} options={{ title: global.lang.wc240bl_record, tabBarIcon: tabIcon3 }} />
      </Tab.Navigator>
    )
  }

  localized(d) {
    var fileName =d.currentDealer + '_' + d.pageId + '_' + d.language +'.json'
    var localFile =d.pageId + '_' + d.language

    var path = Platform.OS === 'ios' ? RNFS.DocumentDirectoryPath+'/LanguagePack' : RNFS.DocumentDirectoryPath + '/language'
    RNFS.readDir(path) // On Android, use "RNFS.DocumentDirectoryPath" (MainBundlePath is not defined)
      .then((result) => {
        // console.log('GOT RESULT', result);
        for (let index = 0; index < result.length; index++) {
          const element = result[index];
          if (element.name == fileName) {
            return Promise.all([RNFS.stat(result[index].path), result[index].path]);
          }
        }
        // stat the first file
      })
      .then((statResult) => {
        // console.log("statResult", statResult);
        if (statResult[0].isFile()) {
          // if we have a file, read it
          return RNFS.readFile(statResult[1], 'utf8');
        }
        return 'no file';
      })
      .then((contents) => {
        // log the file contents
        if (contents) {
          // console.log('content:', JSON.parse(contents));
          global.lang = JSON.parse(contents);
          this.setState({
            flag: true
          })
//          console.log('global.lang', global.lang)
        } else {
          var datas = lan.languages[localFile]
          global.lang = datas;
          this.setState({
            flag: true
          })
        }
      })
      .catch((err) => {
        var datas = lan.languages[localFile]
        global.lang = datas;
        this.setState({
          flag: true
        })
        console.log(err.message, err.code);
      });
  }

  renderView() {
    global.brand = this.props.screenProps.brandName
    let device = Func.formatHyecoDeviceModel(this.props.screenProps);
    global.urlHost = device.urlHost
    global.urlImage = device.urlImage
    global.macAddress=device.macAddress
    if (this.state.flag) {
        return (
          <Provider store={store}>
            <RootSiblingParent>
              <NavigationContainer >
                <StatusBar backgroundColor={constants.colors.themeColor} barStyle="light-content" />
                <Stack.Navigator screenOptions={{headerShown:false,gestureEnabled:false}} >
                  <Stack.Screen name='Tab' component={this.Tab} initialParams={device} option={{ title: 'Tab' }} />
                  <Stack.Screen name='Edit' component={Edit} options={{ title: 'Edit' }} />
                  <Stack.Screen name='SiteEdit' component={SiteEdit} options={{title:'SiteEdit'}}/>

                  <Stack.Screen name='ProgramEditScreen' component={ProgramEditScreen} options={{title:'ProgramEdit'}} />
                  <Stack.Screen name='RepeatScreen' component={RepeatScreen} options={{title:'Repeat'}}/>
                  <Stack.Screen name='TimesScreen' component={TimesScreen} options={{title:'Times'}}/>
                  <Stack.Screen name='HowLongScreen' component={HowLongScreen} options={{title:'HowLong'}}/>
                  <Stack.Screen name='PlanListScreen' component={PlanListScreen} options={{title:'PlanList'}}/>
                  <Stack.Screen name='PlanListRotationScreen' component={PlanListRotationScreen} options={{title:'PlanList'}}/>
                  <Stack.Screen name='AutoTest' component={AutoTest} options={{ title: '设备测试' }} />

                </Stack.Navigator>
              </NavigationContainer>
            </RootSiblingParent>
          </Provider>
        )
    } else {
      this.localized(device)
      return (<View ></View>)//{loadingView.show()}
    }
  }
  render() {
    return (
      this.renderView()
    )
  }

}
export default App;
