# dynamoDB

resource "aws_dynamodb_table" "pins" {
  name         = local.dynamodb_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  server_side_encryption {
    enabled = true
  }

  lifecycle {
    prevent_destroy = false
  }
}
