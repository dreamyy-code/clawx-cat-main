ok = system("tar", "--version")
puts "tar_ok=#{ok.inspect}"
puts "status=#{$?.exitstatus.inspect}"
ok_where = system("where", "tar")
puts "where_ok=#{ok_where.inspect}"
puts "where_status=#{$?.exitstatus.inspect}"
