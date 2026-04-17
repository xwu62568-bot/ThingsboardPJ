import React from 'react'
import {createStackNavigator} from '@react-navigation/stack'

import ProgramScreen from './Program'
const Stack = createStackNavigator();

class Program extends React.Component{
    
    render(){
        

        return(
            <Stack.Navigator screenOptions={{headerShown : false}}>
                <Stack.Screen name='ProgramScreen' component={ProgramScreen} initialParams={this.props.route.params} options={{title:'Program'}}/>
            </Stack.Navigator>
        )
    }
}

export default Program;