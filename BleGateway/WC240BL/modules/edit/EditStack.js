import React from 'react'
import {createStackNavigator} from '@react-navigation/stack'

import EditScreen from './Edit'
import Season from './Season';

const Stack = createStackNavigator();

class Edit extends React.Component{
    
    render(){
        

        return(
            <Stack.Navigator screenOptions={{headerShown : false}}>
                <Stack.Screen name='EditScreen' component={EditScreen} initialParams={this.props.route.params} options={{title:'EditScreen'}}/>
                <Stack.Screen name='Season' component={Season} options={{ title: 'ChildDevice' }} />
            </Stack.Navigator>
        )
    }
}

export default Edit;