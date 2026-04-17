import Func from "./Func"
function byteToKLV(byte_h, byte_l) {
  const key = (byte_h >> 4) & 0x0f
  const key_id = ((byte_h & 0x0f) << 2) | ((byte_l >> 6) & 0x03)
  const parsedLen = (byte_l & 0x3f)

  const keys = Object.keys(commands)
  for (let i = 0; i < keys.length; i++) {
    const v = commands[keys[i]]
    if (key === v.key && key_id === v.key_id) {
      return { ...v, len: (v.len == null ? parsedLen : v.len) }
    }
  }
  return { key, key_id, len: parsedLen }
}
function parseKLV(key,keyId,len){
    let klv = (key << 12) | ((keyId << 6) + len)
    let tt = buffer_uint16(klv & 0xFFFF)
    return tt
}
/**
 * 1 byte 无符号
 * @param  value 
 * @returns 
 */
function buffer_uint8(value) {
    var uint8Array = new Uint8Array(1);
    var dv = new DataView(uint8Array.buffer, 0);
    dv.setUint8(0, value);//写入 1 个字节的 8 位无符号整数。
    return [].slice.call(uint8Array);
}
/**
 * 1 byte 有符号
 * @param  value 
 * @returns 
 */
function buffer_int8(value) {
    var uint8Array = new Uint8Array(1);
    var dv = new DataView(uint8Array.buffer, 0);
    dv.setInt8(0, value);
    return [].slice.call(uint8Array);
}
/**
 * 2 byte 无符号
 * @param  value int
 * @returns byte 数组
 */
function buffer_uint16(value) {
    var uint8Array = new Uint8Array(2);
    var dv = new DataView(uint8Array.buffer, 0);
    dv.setUint16(0, value);
    return [].slice.call(uint8Array);
}
/**
 * 2 byte 有符号
 * @param  value int
 * @returns byte 数组
 */
function buffer_int16(value) {
    var uint8Array = new Uint8Array(2);
    var dv = new DataView(uint8Array.buffer, 0);
    dv.setInt16(0, value);
    return [].slice.call(uint8Array);
}
/**
 * 3 byte 无符号
 * @param  value 
 */
function buffer_uint24(value){
    var buffer = buffer_uint32(value)
    return buffer.slice(1)
}
/**
 * 4 个字节 无符号
 * @param value 
 * @returns byte 数组
 */
function buffer_uint32(value) {
    var uint8Array = new Uint8Array(4);
    var dv = new DataView(uint8Array.buffer, 0);
    dv.setUint32(0, value); //写入 4 个字节的 32 位无符号整数
    return [].slice.call(uint8Array);
}
/**
 * 4 个字节 有符号
 * @param {*} value 
 * @returns 
 */
function buffer_int32(value) {
    var uint8Array = new Uint8Array(4);
    var dv = new DataView(uint8Array.buffer, 0);
    dv.setInt32(0, value);
    return [].slice.call(uint8Array);
}
/**
 * crc 计算和校验
 * @param {*} byteArray 
 * @param {*} len 
 * @return 0 校验成功，其他值代表算出的crc
 */
function CRCCalc(byteArray,len){
    var crc = 0xffff
    for(let n=0; n<len; n++){
        
        crc = crc ^ byteArray[n]
        for(let i=0; i<8; i++){
            var tt = (crc & 1)
            crc = (crc >> 1)
            crc = (crc & 0x7fff)
            if(tt == 1){
                crc = (crc ^ 0xa001)
            }
            crc = (crc & 0xffff)
        }
    }
    return crc
}
let commands = {
   

    site_on_off:               {key:0x01, key_id:0x01, len:1},//bit xxxx xxxx 对应站点 8~1 bit 取 0 表示关闭该站点，1 打开该站点

    site_disable:               {key:0x01, key_id:0x05, len:1},// 0可用 1 禁用 bit 0000 xxxx
    record_delete:              {key:0x01, key_id:0x06, len:1},//删除记录
    stand_by:                   {key:0x01, key_id:0x07, len:1},//0:取消暂停 1:暂停

    manual_time:                {key:0x02, key_id:0x01, len:2},
    ec_open_time:               {key:0x02, key_id:0x02, len:2},
    ec_close_time:              {key:0x02, key_id:0x03, len:2},
    season_adjust_mode:         {key:0x02, key_id:0x04, len:1},
    season_adjust_all:          {key:0x02, key_id:0x05, len:1},////有符号
    season_adjust_month:        {key:0x02, key_id:0x06, len:12},//有符号，
    soil_sensor:                {key:0x02, key_id:0x07, len:1},
    wired_rain_sensor:          {key:0x02, key_id:0x08, len:1},
    site1_mode:                 {key:0x02, key_id:0x09, len:1},
    

    site_on_off_state:          {key:0x03, key_id:0x01, len:1},
    site1_open_role:            {key:0x03, key_id:0x02, len:1},//站点一打开时的角色  0：站点1，1：作为主阀
    site_remaining_time:        {key:0x03, key_id:0x03,},//站点剩余开阀时长 长度为：站点数*2 顺序为：4321
    site_total_time:            {key:0x03, key_id:0x04,},//站点开阀总时长 长度为：站点数*2 顺序为：4321
    battery:                    {key:0x03, key_id:0x05,len:1},//电量
    sync_time:                  {key:0x03, key_id:0x06,len:4},//同步时间
    time_zone:                  {key:0x03, key_id:0x07,len:4},//单位是秒 带符号
    soil_sensor_state:          {key:0x03, key_id:0x08,len:1},//土壤传感器状态
    wired_rain_sensor_state:    {key:0x03, key_id:0x09,len:1},//有线雨量传感器状态

    //record:                     {key:0x06, key_id:0x01, len:60}, //len固定 不足的补0，超过分包
    recordMore:                  {key:0x06, key_id:0x01, len:63}, //多路 len固定 不足的补0，超过分包


    message:                    {key:0x07, key_id:0x01, len:1},//00: 电池电量正常 01: 电池低于 8V 02: 电池低于 7.5V

    repeat_mode:                {key:0x09, key_id:0x01, len:1},
    week_day:                   {key:0x09, key_id:0x02, len:1},
    interval_day:               {key:0x09, key_id:0x03, len:1},
    even_odd:                   {key:0x09, key_id:0x04, len:1},
    skip_week:                  {key:0x09, key_id:0x05, len:1},//0000 0001 跳过周日、 0000  0010 跳过周一 、0100 0000  跳过周六，可多选
    ec_on_off:                  {key:0x09, key_id:0x06, len:1},
    season_on_off:              {key:0x09, key_id:0x07, len:1}, 

    times:                      {key:0x09, key_id:0x08,len:45},   //len固定 不足的补0，超过分包
    site1_how_long:             {key:0x09, key_id:0x09,len:2},    
    site2_how_long:             {key:0x09, key_id:0x0a,len:2},    
    site3_how_long:             {key:0x09, key_id:0x0b,len:2},    
    site4_how_long:             {key:0x09, key_id:0x0c,len:2},    
    site5_how_long:             {key:0x09, key_id:0x0d,len:2},    
    site6_how_long:             {key:0x09, key_id:0x0e,len:2},    
    site7_how_long:             {key:0x09, key_id:0x0f,len:2},    
    site8_how_long:             {key:0x09, key_id:0x10,len:2},    
}

function commandToByteArray(command,value){
    var byteArray = parseKLV(command.key,command.key_id,command.len)

    if(command.key == commands.times.key && command.key_id == commands.times.key_id){//时间
        console.log('时间：',value)
        let timeBuffer = value.reduce((result, item) => {
            result = result.concat(buffer_uint24(item))
            return result
        },[])
        console.log('时间：',hexToString(timeBuffer))
        byteArray.push(...timeBuffer)

    }else if(command.key == commands.manual_time.key && command.key_id == commands.manual_time.key_id){ //手动开阀时长，长度不固定，长度=2*站点数
        value.forEach(element => {
            byteArray.push(...buffer_int16(element))
        });

    }else if(command.key == commands.season_adjust_month.key && command.key_id == commands.season_adjust_month.key_id){//有符号 季节按月调整  value 是数组长度是12
    
        value.forEach(element => {
            byteArray.push(...buffer_int8(element))
        });
        
    }else if(command.key == commands.season_adjust_all.key && command.key_id == commands.season_adjust_all.key_id){//有符号 季节调整全部
        
        byteArray.push(...buffer_int8(value))

    }else if(command.key == commands.time_zone.key && command.key_id == commands.time_zone.key_id){

        byteArray.push(...buffer_int32(value))
    
    }else{

        if(command.len == 1){
            byteArray.push(...buffer_uint8(value))
        }else if(command.len == 2){
            byteArray.push(...buffer_uint16(value))
        }else if(command.len == 4){
            byteArray.push(...buffer_uint32(value))
        }
        
    }
    console.log('commandToByteArray',hexToString(byteArray))
    return byteArray
}

function packSendCommand(messageId,command){

    var head = [0x7b,0xca]
    return packCommand(head,messageId,command)
}

function packRequestCommand(messageId,command){
    var head = [0x7b,0xcb]
    return packCommand(head,messageId,command)
}

function packCommand(head,messageId,command){
    var byteArray = []
    //2 包头 2 包长 1 消息id  ... 2 crc
    var len = buffer_uint16(2 + 2 + 1 + command.length + 2)
    var msgId = buffer_uint8(messageId)
    byteArray.push(...head)
    byteArray.push(...len)
    byteArray.push(...msgId)
    byteArray.push(...command)
    //计算crc
    var crc = buffer_uint16(CRCCalc(byteArray,byteArray.length))
    byteArray.push(crc[1],crc[0])//高低位
    console.log('packSendCommand',hexToString(byteArray))
    return byteArray
}

function hexToString(array){
    var str = ''
    
    array.forEach( byte => {
        let t = byte.toString(16)
        if(t.length == 1){
            str += ('0'+t+' ')
        }else{
            str += (t+' ')
        }
    })
    return str
}
//week str : '1010100' 周一到周日
// return 00101010  最后是周日 往前 一，二...
function parseWeek(weekStr){
    let week = 0b00000000
    for(i=0;i<weekStr.length;i++){
        const c = weekStr.charAt(i)

        if(i == 6 && c == '1'){
            week = (week | 0b00000001)
        }
        if(i == 0 && c == '1'){
            week = (week | 0b00000010)
        }
        if(i == 1 && c == '1'){
            week = (week | 0b00000100)
        }
        if(i == 2 && c == '1'){
            week = (week | 0b00001000)
        }
        if(i == 3 && c == '1'){
            week = (week | 0b00010000)
        }
        if(i == 4 && c == '1'){
            week = (week | 0b00100000)
        }
        if(i == 5 && c == '1'){
            week = (week | 0b01000000)
        }
    }
    return week
}
function messageId(){
    if(global.messageId == null || global.messageId == 255){
        global.messageId = 1
    }else{
        global.messageId++
    }
    return global.messageId
}
/**
 * 
 * @param siteNumber 站点编号 ，int类型
 * @param onOff 开关 int类型
 */
function siteOnOff(siteNumber,onOff){
    if(siteNumber < 1 || siteNumber > 8){
        console.log('site on off 错误的站点号:',siteNumber)
        return -1
    }
    if(onOff < 0 || onOff > 1){
        console.log('site on off 错误的开关值:',onOff)
        return -2
    }
    var byteArray = []
    var siteOnOff = 0
    switch(siteNumber){
        case 1: siteOnOff = siteOnOff | (onOff ? 0b1 : 0);break;
        case 2: siteOnOff = siteOnOff | (onOff ? 0b10 : 0);break;
        case 3: siteOnOff = siteOnOff | (onOff ? 0b100 : 0);break;
        case 4: siteOnOff = siteOnOff | (onOff ? 0b1000 : 0);break;
        case 5: siteOnOff = siteOnOff | (onOff ? 0b10000 : 0);break;
        case 6: siteOnOff = siteOnOff | (onOff ? 0b100000 : 0);break;
        case 7: siteOnOff = siteOnOff | (onOff ? 0b1000000 : 0);break;
        case 8: siteOnOff = siteOnOff | (onOff ? 0b10000000 : 0);break;
    }
    byteArray = commandToByteArray(commands.site_on_off,siteOnOff)

    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send on off',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {Array} sites 站点列表
 * @param {boolean} onOff 开关标识
 * @returns 
 */
function onOffSelectSite(sites,onOff){
    if(sites==null || sites.length<0){
        return
    }
    var siteOnOff = 0
    if(onOff){//开阀
        sites.forEach((site,index) => {
            if(!site.disabled && site.selected){
                siteOnOff = siteOnOff | (1 << index)
            }
        })
        if(siteOnOff == 0){ 
            return
        }
    }
    var byteArray = commandToByteArray(commands.site_on_off,siteOnOff)
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send select site onOff',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 站点手动开阀时长，站点序号小的在后面，长度不固定，长度=2*站点数 
 * @param sites 站点数组
 */
function setSiteDuration(sites){
    if(sites==null || sites.length<0){
        return
    }
    var byteArray = []
    commands.manual_time.len = sites.length * 2

    var howLongArray = []
    sites.forEach(element => {
       howLongArray.push((element.how_long)/1000)//howlong单位是毫秒,设备接受的是秒
    })
    byteArray = commandToByteArray(commands.manual_time,howLongArray.reverse())
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send setSiteDuration',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    return byteArray
}


function setDeviceTimeAndZone(time,offset){
    var byteArray = commandToByteArray(commands.time_zone,offset)
    byteArray = byteArray.concat(commandToByteArray(commands.sync_time,time))
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send time and offset',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
function deleteRecord(){
    var byteArray = commandToByteArray(commands.record_delete,1)
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send delete record',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {Array} sites 站点数组
 * @returns 
 */
function siteEnable(sites){
    let siteDisable = 0
    sites.forEach( site => {
        switch(site.s){
            case 1: siteDisable = siteDisable | (site.disabled ? 0b1 : 0);break;
            case 2: siteDisable = siteDisable | (site.disabled ? 0b10 : 0);break;
            case 3: siteDisable = siteDisable | (site.disabled ? 0b100 : 0);break;
            case 4: siteDisable = siteDisable | (site.disabled ? 0b1000 : 0);break;
            case 5: siteDisable = siteDisable | (site.disabled ? 0b10000 : 0);break;
            case 6: siteDisable = siteDisable | (site.disabled ? 0b100000 : 0);break;
            case 7: siteDisable = siteDisable | (site.disabled ? 0b1000000 : 0);break;
            case 8: siteDisable = siteDisable | (site.disabled ? 0b10000000 : 0);break;
        }
    })
    var byteArray = commandToByteArray(commands.site_disable,siteDisable)
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send site enable',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {boolean} standby 是否暂停
 * @returns 
 */
function standyBy(standby){
    let byteArray = commandToByteArray(commands.stand_by,standby ? 1 : 0)
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send standyBy',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {number} mode 模式
 * @returns 
 */
function site1Master(mode){
    let byteArray = commandToByteArray(commands.site1_mode,mode)
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send site1Master',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {boolean} onOff 
 * @returns 
 */
function rainSensor(onOff){
    let byteArray = commandToByteArray(commands.wired_rain_sensor,onOff ? 1 : 0)
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send rainSensor',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {number} value 
 * @returns 
 */
function soilSensor(value){
    let byteArray = commandToByteArray(commands.soil_sensor,value == -1 ? 255 : value)
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send soilSensor',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {number} mode 
 * @returns 
 */
function seasonMode(mode){
    let byteArray = []
    //季节调整模式
    byteArray = byteArray.concat(commandToByteArray(commands.season_adjust_mode,mode))
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send seasonMode',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
    
}
/**
 * 
 * @param {number} adjustAll 
 * @returns 
 */
function seasonAdjustAll(adjustAll){
    let byteArray = []
    //季节变化-全部
    byteArray = byteArray.concat(commandToByteArray(commands.season_adjust_all,adjustAll))
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send seasonAdjustAll',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {Array} adjustMonth 
 * @returns 
 */
function seasonAdjustMonth(adjustMonth){
    let byteArray = []
    //季节变化-按月
    byteArray = byteArray.concat(commandToByteArray(commands.season_adjust_month,adjustMonth))
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send seasonAdjustMonth',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
/**
 * 
 * @param {number} ecOpen 
 * @param {number} ecClose 
 * @returns 
 */
function ecTime(ecOpen,ecClose){
    let byteArray = []
    //EC 开时长
    byteArray = byteArray.concat(commandToByteArray(commands.ec_open_time,ecOpen))
    //EC 关时长
    byteArray = byteArray.concat(commandToByteArray(commands.ec_close_time,ecClose))
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send ecTime',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    
    return byteArray
}
function sync(device){
    var byteArray = []

    var program 
    for(key in device.programs){
        if(device.programs[key].s == device.current_run_program){
            program = device.programs[key]
            break
        }
    }
    if(program == null){
        return -1
    }
  
    //程序参数-周循环 周几
    byteArray = byteArray.concat(commandToByteArray(commands.week_day,parseWeek(program.parameter.weekdays)))
    //程序参数-间隔天数
    byteArray = byteArray.concat(commandToByteArray(commands.interval_day,program.parameter.interval_days))
    //程序参数-奇偶
    byteArray = byteArray.concat(commandToByteArray(commands.even_odd,program.parameter.even_odd))
    //程序参数-EC状态 0 关 1 开(1Byte)
    byteArray = byteArray.concat(commandToByteArray(commands.ec_on_off,program.parameter.ec_on_off == 'false' ? 0 : 1))

    //周循环模式下 取消跳过周几 
    let skip_days = program.parameter.skip_days 
      if(program.parameter.repeat_mode == Func.commonFunc.repeat_mode_week){
          skip_days  = '0000000'
      }

    //浇水跳过周几
    byteArray = byteArray.concat(commandToByteArray(commands.skip_week,parseWeek(skip_days)))
    //程序参数-季节变化状态 0 关 1 开
    byteArray = byteArray.concat(commandToByteArray(commands.season_on_off,program.parameter.season_differ_on_off == 'false' ? 0 : 1))
    //程序参数-时长 没有的补0  how_long: [ { '1': 300 }, { '2': 300 }, { '3': 300 }, { '4': 300 } ],
    if(device.channels > 0){
        for(let i=0;i<device.channels;i++){
            let siteHowLong = 0
            program.how_long.forEach( item => {
                var site = Object.keys(item)[0]
                if(site == (i+1)){
                    siteHowLong = item[site]
                }
            })
            if(i == 0){ 
                if(device.site1_mode==Func.commonFunc.site1_master)
                    byteArray = byteArray.concat(commandToByteArray(commands.site1_how_long,0))
                else 
                    byteArray = byteArray.concat(commandToByteArray(commands.site1_how_long,siteHowLong))
            }
            if(i == 1){ byteArray = byteArray.concat(commandToByteArray(commands.site2_how_long,siteHowLong)) }
            if(i == 2){ byteArray = byteArray.concat(commandToByteArray(commands.site3_how_long,siteHowLong)) }
            if(i == 3){ byteArray = byteArray.concat(commandToByteArray(commands.site4_how_long,siteHowLong)) }
            if(i == 4){ byteArray = byteArray.concat(commandToByteArray(commands.site5_how_long,siteHowLong)) }
            if(i == 5){ byteArray = byteArray.concat(commandToByteArray(commands.site6_how_long,siteHowLong)) }
            if(i == 6){ byteArray = byteArray.concat(commandToByteArray(commands.site7_how_long,siteHowLong)) }
            if(i == 7){ byteArray = byteArray.concat(commandToByteArray(commands.site8_how_long,siteHowLong)) }
        }

    }
    //程序参数-时间 15个一包，不足的补0
    // byteArray = byteArray.concat(commandToByteArray(commands.times,program.times))
    var times_loop = program.times.length / 15
    for(j=0; j<times_loop; j++){
        var startPos = j * 15
        var tempTimes = []
        for(i=0; i<15;i++){
            var position = startPos + i
            if(position < program.times.length){
                tempTimes.push(program.times[position])
            }else{
                tempTimes.push(0xffffff)//补ff
            }
        }
        byteArray = byteArray.concat(commandToByteArray(commands.times,tempTimes))
    }
   
    //程序参数-重复模式
    byteArray = byteArray.concat(commandToByteArray(commands.repeat_mode,program.parameter.repeat_mode))

    byteArray = packSendCommand(messageId(),byteArray)
    console.log('send sync',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    return byteArray
}
/**
 * 同步设备的设置项
 * @param {Object} device 
 * @param {Int} offset 
 * @param {Int} time 
 */
function syncSetting(device,time,offset){
    //时间和时区
    var byteArray = commandToByteArray(commands.time_zone,offset)
    byteArray = byteArray.concat(commandToByteArray(commands.sync_time,time))
    //启用禁用
    var siteDisable = 0
    device.sites.forEach( site => {
        switch(site.s){
            case 1: siteDisable = siteDisable | (site.disabled ? 0b1 : 0);break;
            case 2: siteDisable = siteDisable | (site.disabled ? 0b10 : 0);break;
            case 3: siteDisable = siteDisable | (site.disabled ? 0b100 : 0);break;
            case 4: siteDisable = siteDisable | (site.disabled ? 0b1000 : 0);break;
            case 5: siteDisable = siteDisable | (site.disabled ? 0b10000 : 0);break;
            case 6: siteDisable = siteDisable | (site.disabled ? 0b100000 : 0);break;
            case 7: siteDisable = siteDisable | (site.disabled ? 0b1000000 : 0);break;
            case 8: siteDisable = siteDisable | (site.disabled ? 0b10000000 : 0);break;
        }
    })
    byteArray = byteArray.concat(commandToByteArray(commands.site_disable,siteDisable))
    //设备暂停
    if(device.baseType != "wc280bl"){ //8路取消了设备暂停
        byteArray = byteArray.concat(commandToByteArray(commands.stand_by,device.standby ? 1 : 0))
    }
    //手动开阀时长
    //byteArray = byteArray.concat(commandToByteArray(commands.manual_time,device.manual_time))
    //站点开阀时长
    commands.manual_time.len = device.sites.length * 2
    var howLongArray = []
    device.sites.forEach(element => {
       howLongArray.push((element.how_long)/1000)//howlong单位是毫秒,设备接受的是秒
    })
    byteArray = byteArray.concat(commandToByteArray(commands.manual_time,howLongArray.reverse()))

    //EC 开时长
    byteArray = byteArray.concat(commandToByteArray(commands.ec_open_time,device.ec_open_time))
    //EC 关时长
    byteArray = byteArray.concat(commandToByteArray(commands.ec_close_time,device.ec_close_time))
  
    //季节调整模式
    byteArray = byteArray.concat(commandToByteArray(commands.season_adjust_mode,device.season_adjust_mode))
    //季节变化-全部
    byteArray = byteArray.concat(commandToByteArray(commands.season_adjust_all,device.season_adjust_all))
    //季节变化-按月
    byteArray = byteArray.concat(commandToByteArray(commands.season_adjust_month,JSON.parse(device.season_adjust_month)))
    //土壤传感器状态
    byteArray = byteArray.concat(commandToByteArray(commands.soil_sensor,device.soil_sensor == -1 ? 255 : device.soil_sensor))
    //有线雨量状态
    byteArray = byteArray.concat(commandToByteArray(commands.wired_rain_sensor,device.wired_rain_sensor ? 1 : 0))
    //站点1 模式
    if(device.baseType != "wc280bl"){ //8路没有站点1模式
        byteArray = byteArray.concat(commandToByteArray(commands.site1_mode,device.site1_mode))
    }
    
    byteArray = packSendCommand(messageId(),byteArray)
    console.log('setting sync',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    return byteArray
}
function requestRecord(sites){
    var byteArray 
    // if(sites.length==1){
    //      byteArray = packRequestCommand(messageId(),parseKLV(commands.record.key,commands.record.key_id,commands.record.len))
    // }else{
         byteArray = packRequestCommand(messageId(),parseKLV(commands.recordMore.key,commands.recordMore.key_id,commands.recordMore.len)) //记录长度统一为63了
    // }
    console.log('request record',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    return byteArray
}
function requestOnOffState(sites){
    var byteArray = []
    byteArray = byteArray.concat(parseKLV(commands.site_on_off_state.key,commands.site_on_off_state.key_id,commands.site_on_off_state.len))
    //传感器状态
    if(sites.length<8){//8路暂时不显示 
        byteArray = byteArray.concat(parseKLV(commands.soil_sensor_state.key,commands.soil_sensor_state.key_id,commands.soil_sensor_state.len))
    }
    byteArray = byteArray.concat(parseKLV(commands.wired_rain_sensor_state.key,commands.wired_rain_sensor_state.key_id,commands.wired_rain_sensor_state.len))

    byteArray = packRequestCommand(messageId(),byteArray)
    console.log('request on off state',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    return byteArray
}
function requestDeviceState(sites){
    var byteArray = []
    //开关状态
    byteArray = byteArray.concat(parseKLV(commands.site_on_off_state.key,commands.site_on_off_state.key_id,commands.site_on_off_state.len))
    //传感器状态
    if(sites.length<8){//8路暂时不显示 
        byteArray = byteArray.concat(parseKLV(commands.soil_sensor_state.key,commands.soil_sensor_state.key_id,commands.soil_sensor_state.len))
    }
    byteArray = byteArray.concat(parseKLV(commands.wired_rain_sensor_state.key,commands.wired_rain_sensor_state.key_id,commands.wired_rain_sensor_state.len))
    //剩余开阀时长
    commands.site_remaining_time.len = sites.length * 2
    byteArray = byteArray.concat(parseKLV(commands.site_remaining_time.key,commands.site_remaining_time.key_id,commands.site_remaining_time.len))
    //开阀总时长
    commands.site_total_time.len = sites.length * 2
    byteArray = byteArray.concat(parseKLV(commands.site_total_time.key,commands.site_total_time.key_id,commands.site_total_time.len))
    byteArray = packRequestCommand(messageId(),byteArray)
    console.log('request device state',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    return byteArray
}

function requestTimeAndBattery(){
    var byteArray = []
    byteArray = byteArray.concat(parseKLV(commands.battery.key,commands.battery.key_id,commands.battery.len))
    byteArray = byteArray.concat(parseKLV(commands.sync_time.key,commands.sync_time.key_id,commands.sync_time.len))
    byteArray = packRequestCommand(messageId(),byteArray)
    console.log('request time and battery',hexToString(byteArray))
    console.log('crc',CRCCalc(byteArray,byteArray.length))
    return byteArray
}
/**
 * 验证klv是否合法
 * @param {*} cmdH 
 * @param {*} cmdL 
 * @returns 
 */
function verifyCommand(cmdH,cmdL){
    const cmd = byteToKLV(cmdH,cmdL)
    let pass = false
    const keys = Object.keys(commands)
    for(let i=0; i<keys.length; i++){
        const item = commands[keys[i]]
        if(item.key == cmd.key && item.key_id == cmd.key_id){
            pass = true
            break
        }
    }
    return pass
}
export default {
    commands,
    CRCCalc,
    setDeviceTimeAndZone,
    siteOnOff,
    deleteRecord,
    sync,
    requestRecord,
    requestOnOffState,
    requestTimeAndBattery,
    hexToString,
    byteToKLV,
    setSiteDuration,
    onOffSelectSite,
    site1Master,
    siteEnable,
    standyBy,
    rainSensor,
    soilSensor,
    seasonMode,
    seasonAdjustAll,
    seasonAdjustMonth,
    ecTime,
    requestDeviceState,
    verifyCommand,
    syncSetting,
}