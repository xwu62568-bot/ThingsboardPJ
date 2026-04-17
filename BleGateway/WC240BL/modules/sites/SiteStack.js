import React from 'react'
import {createStackNavigator} from '@react-navigation/stack'

import SitesScreen from "./Sites"
import SiteEdit from './SiteEdit';
const Stack = createStackNavigator();

class Site extends React.Component{
    
    render(){
        

        return(
            <Stack.Navigator screenOptions={{headerShown : false}}>
                <Stack.Screen name='SitesScreen' component={SitesScreen} initialParams={this.props.route.params} options={{title:'SitesScreen'}}/>
            </Stack.Navigator>
        )
    }
}
// export default connect((state) => {
//     return {
//         state
//     }
// })(Home)
export default Site;