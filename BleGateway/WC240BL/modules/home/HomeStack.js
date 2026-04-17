import React from 'react'
import {createStackNavigator} from '@react-navigation/stack'

import HomeScreen from './Home'
const Stack = createStackNavigator();

class Home extends React.Component{
    
    render(){
        

        return(
            <Stack.Navigator screenOptions={{headerShown : false}}>
                <Stack.Screen name='HomeScreen' component={HomeScreen} initialParams={this.props.route.params} options={{title:'Home'}}/>
            </Stack.Navigator>
        )
    }
}

export default Home;