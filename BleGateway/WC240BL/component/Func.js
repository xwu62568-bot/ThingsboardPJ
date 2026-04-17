function formatHyecoDeviceModel(value) {
    // console.log(value);
    let loraAttrArr = value.loraAttrArr;
    let device = {
        urlHost: value.urlHost,
        urlImage: value.urlImage,
        deviceTypeIcon: value.deviceTypeIcon,
        serialNumber: value.serialNumber,
        Authorization: value.Authorization,
        deviceId: value.deviceId,
        userId: value.userId,
        whetherOnline: value.whetherOnline,
        language: value.language,
        name: value.name,
        brand: global.brand,
        productType: value.productType,
        dealerLogFid: value.dealerLogFid,
        macAddress:value.macAddress,
        deviceLocation: value.deviceLocation,
        baseType: String(value.baseType).toLowerCase(),
        pageId: value.pageId,
        currentDealer: value.currentDealer,
        frequency: value.frequency,
        unit: value.unit,
        offset: value.offset,
        hardware: '',
        firmware: value.firmware,
         maxVersion:value.maxVersion,
        minVersion:value.minVersion,
        sites: Array(8).fill({s:0}).map((_,index)=>{ return {s:(index+1),selected:false}}),
        site1_mode:commonFunc.site1_normal,
        wired_rain_sensor:false,
        soil_sensor:-1,
        standby: false,//设备状态
        season_adjust_mode:0,
        season_adjust_all:0,
        season_adjust_month:[],
        ec_open_time:0,
        ec_close_time:0,
        manual_time:0,
        channels: 0,
        programs:[{tag:'A',s:1},{tag:'B',s:2},{tag:'C',s:3},{tag:'D',s:4}],
        last_update_time:0,
        last_sync_time:0,
        rssi: 0,
        current_run_program:'',
        battery:0,
        peerUUID:''
    };
    let sites = device.sites

    for (const key in loraAttrArr) {
      let item = loraAttrArr[key];
      if(item.identifier == null || item.identifierValue == null){
        continue
      }
        if (item.identifier.indexOf("02") == 0) {

            let onOffMatch = item.identifier.match(wc240bl.site_on_off_reg)
            if(onOffMatch != null){
              let site = parseInt(onOffMatch[1])
              if(site>0 && site <= 8){
                  sites[site-1].on_off = item.identifierValue.bool()
              }
              continue
            }
            let howLongMatch = item.identifier.match(wc240bl.site_how_long_reg)
            if(howLongMatch != null){
              let site = parseInt(howLongMatch[1])
              if(site > 0 && site <= 8){
                  sites[site-1].how_long = parseInt(item.identifierValue)*1000
              }
              continue
            }
           
        } else if (item.identifier.indexOf("03") == 0) {
            switch (item.identifier) {
                case wc240bl.site1_mode:
                    device.site1_mode = parseInt(item.identifierValue)
                    break;
                case wc240bl.wired_rain_sensor:
                    device.wired_rain_sensor = item.identifierValue.bool()
                    break;
                case wc240bl.soil_sensor:
                     device.soil_sensor = parseInt(item.identifierValue)
                    break;
                case wc240bl.standby:
                    device.standby = item.identifierValue.bool()
                    break;
                case wc240bl.season_adjust_mode:
                    device.season_adjust_mode =parseInt(item.identifierValue)
                    break;
                case wc240bl.season_adjust_all:
                    device.season_adjust_all = parseInt(item.identifierValue)
                    break;
                case wc240bl.season_adjust_month:
                    device.season_adjust_month = item.identifierValue
                    break;
                case wc240bl.ec_open_time:
                    device.ec_open_time = parseInt(item.identifierValue)
                    break;
                case wc240bl.ec_close_time:
                    device.ec_close_time = parseInt(item.identifierValue)
                    break;
                case wc240bl.manual_time:
                    device.manual_time = parseInt(item.identifierValue)
                    break;
                case wc240bl.last_sync_time:
                    device.last_sync_time = parseInt(item.identifierValue)
                    break;
                case wc240bl.last_update_time:
                    device.last_update_time = parseInt(item.identifierValue)
                    break;
                case wc240bl.current_run_program:
                    device.current_run_program = parseInt(item.identifierValue)
                    break;
                case wc240bl.selected_sites:
                  try{
                    let array = JSON.parse(item.identifierValue)
                    for(const key in array){
                        const item = array[key]
                        if(item.site1){
                            sites[0].selected = true
                        }else if(item.site2){
                            sites[1].selected = true
                        }else if(item.site3){
                            sites[2].selected = true
                        }else if(item.site4){
                            sites[3].selected = true
                        }else if(item.site5){
                            sites[4].selected = true
                        }else if(item.site6){
                            sites[5].selected = true
                        }else if(item.site7){
                            sites[6].selected = true
                        }else if(item.site8){
                            sites[7].selected = true
                        }
                    }
                  }catch{
                      console.log("选中的站点格式错误：",item.identifierValue)
                  }
              
                  break;
                default :
                    
                    if(item.identifierValue.length == 0) continue;
                 
                    let parameterMatch = item.identifier.match(wc240bl.program_parameter_reg)
                    if(parameterMatch != null){
                      let tag = String(parameterMatch[1]).toLocaleUpperCase()
                      let propram = device.programs.filter( t => t.tag == tag )
                      if(propram.length > 0){
                        propram[0].parameter = JSON.parse(item.identifierValue)
                      }
                      break;
                    }

                    let timesMatch = item.identifier.match(wc240bl.program_times_reg)
                    if(timesMatch != null){
                      let tag = String(timesMatch[1]).toLocaleUpperCase()
                      let propram = device.programs.filter( t => t.tag == tag )
                      if(propram.length > 0){
                        propram[0].times = JSON.parse(item.identifierValue)
                      }
                      break;
                    }

                    let how_longMatch = item.identifier.match(wc240bl.program_site_how_long_reg)
                    if(how_longMatch != null){
                      let tag = String(how_longMatch[1]).toLocaleUpperCase()
                      let propram = device.programs.filter( t => t.tag == tag )
                     
                      if(propram.length > 0){
                        propram[0].how_long = JSON.parse(item.identifierValue)
                      }
                      break;
                    }

                    let disabledMatch = item.identifier.match(wc240bl.site_disabled_reg)
                    if(disabledMatch != null){
                      let site = parseInt(disabledMatch[1])
                      if(site>0 && site <= 8){
                          sites[site-1].disabled = item.identifierValue.bool()
                      }
                      break;
                    }
                    break 
                        
            }
        }else if (item.identifier.indexOf("05") == 0) {
            if(item.identifier==wc240bl.channels){
                if(item.identifierValue){
                    device.channels = parseInt(item.identifierValue)
                }

            }
          
        } else if (item.identifier.indexOf("08") == 0) {
            let photoMatch = item.identifier.match(wc240bl.site_photo_reg)
            if(photoMatch != null){
              let site = parseInt(photoMatch[1])
              if(site>0 && site <= 8){
                sites[site-1].photo = item.identifierValue
              }
              continue
            }
            let nameMatch = item.identifier.match(wc240bl.site_name_reg)
            if(nameMatch != null){
              let site = parseInt(nameMatch[1])
              if(site>0 && site <= 8){
                sites[site-1].name = item.identifierValue
              }
              continue
            }
          
        } 
    }
    let siteNum = device.channels
    if(siteNum>0 && siteNum <= 8){
      device.sites = sites.slice(0,siteNum)
    }
    return device;
  }
let wc240bl = {
    //02
    site_on_off_reg:/02_site(\d+)_on_off/,
    site_how_long_reg: /02_site(\d+)_howlong/,
    //03
    site1_mode:"03_site1_mode",
    wired_rain_sensor:"03_wired_rain_sensor",
    soil_sensor:"03_soil_sensor",
    standby:"03_standby",
    season_adjust_mode:"03_season_adjust_mode",
    season_adjust_all:"03_season_adjust_all",
    season_adjust_month:"03_season_adjust_month",
    ec_open_time:"03_ec_open_time",
    ec_close_time:"03_ec_close_time",
    manual_time:"03_manual_time",

    last_update_time:"03_last_update_time",
    last_sync_time:"03_last_sync_time",
    current_run_program:"03_current_run_program",

    site_disabled_reg:/03_site(\d+)_disabled/,

    program_parameter_reg:/03_program_(\D+)_parameter/,
    program_times_reg:/03_program_(\D+)_times/,
    program_site_how_long_reg:/03_program_(\D+)_site_how_long/,

    selected_sites:"03_selected_sites",

    //05
    channels:"05_channels",
    
    //06
    record:"06_record",
  
    //08
    site_photo_reg:/08_site(\d+)_photo/,
    site_name_reg:/08_site(\d+)_name/,

  
}

let commonFunc = {
    repeat_mode_week : 1,
    repeat_mode_interval : 2,
    repeat_mode_even_odd : 3,
    even_day : 1,
    odd_day : 2,
    site1_normal:1,
    site1_master:2,
    getRepeat(type){
      if(type == 1){
          return global.lang.wc240bl_weekday
      }
      if(type == 2){
          return global.lang.wc240bl_interval_days
      }
      if(type == 3){
          return global.lang.wc240bl_even_or_odd
      }
    },
    //格式化时间
    formatTime(second,contain_second){
      let h = parseInt(second/3600)
      let m = parseInt(second%3600 / 60)
      if(h < 10){
        h = '0'+h
      }
      if(m < 10){
        m = '0'+m
      }
      if(contain_second){
        let s = parseInt(second%3600 % 60)
        if(s < 10){
            s = '0'+s
        }
        return h+':'+m +':'+s
      }else{
        return h+':'+m 
      }
  },
  parseWeekSelect(week_selected){
    //[{monday:true},{}...]
    var weekArray = Array(7).fill(false)
    if(week_selected != null && week_selected.length == 7){
        for(i=0; i<7; i++){
          let char = week_selected.charAt(i)
            weekArray[i] = char == '1'
        }       
    }
    return weekArray
  },
  weekToString(weekArray){
    let weekStr = ""
    weekArray.forEach(w => {
      weekStr += w ? '1' : '0'
    });
    return weekStr
  }
}
let bleUUID={
  nofityServiceUUID:'0000180f-0000-1000-8000-00805f9b34fb',
  nofityCharacteristicUUID:'00002a19-0000-1000-8000-00805f9b34fb',
  writeWithResponseServiceUUID:'0000180f-0000-1000-8000-00805f9b34fb',
  writeWithResponseCharacteristicUUID:'00002a1a-0000-1000-8000-00805f9b34fb',
  readServiceUUID:'0000180f-0000-1000-8000-00805f9b34fb',
  readCharacteristicUUID:'00002a1b-0000-1000-8000-00805f9b34fb',
  deviceInfoUuid :"0000180a-0000-1000-8000-00805f9b34fb",
  varersionUUID :"00002a50-0000-1000-8000-00805f9b34fb"

}
  
  export default {
    formatHyecoDeviceModel: formatHyecoDeviceModel,
    wc240bl,
    commonFunc,
    bleUUID
  }